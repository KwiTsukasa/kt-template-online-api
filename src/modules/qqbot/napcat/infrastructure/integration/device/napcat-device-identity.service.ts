import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import {
  isRejectedVirtualMacPrefix,
  NAPCAT_PHYSICAL_OUI_PREFIXES,
} from '../../../domain/runtime/napcat-physical-oui-catalog';
import { NapcatDeviceIdentity } from '../../persistence/napcat-device-identity.entity';

type ResolveNapcatDeviceIdentityInput = {
  accountId: string;
  containerId?: string;
  selfId?: string;
};

@Injectable()
export class NapcatDeviceIdentityService {
  /**
   * 初始化 NapcatDeviceIdentityService 实例。
   * @param identityRepository - NapCat仓库依赖；影响 constructor 的返回值。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(NapcatDeviceIdentity)
    private readonly identityRepository: Repository<NapcatDeviceIdentity>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolves the stable device identity used when an account creates or rebuilds its NapCat container.
   * @param input - Account id selects the persistent identity row, container id updates the active binding, and self id seeds non-visible deterministic device values.
   */
  async resolveForAccount(input: ResolveNapcatDeviceIdentityInput) {
    const accountId = `${input.accountId}`.trim();
    const containerName = this.buildContainerName(input.selfId || accountId);
    const existing = await this.identityRepository.findOne({
      where: { accountId },
    });

    if (existing) {
      const containerId = input.containerId || null;
      await this.migrateLegacyIdentityIfNeeded(existing, {
        accountId,
        containerName,
        selfId: input.selfId || '',
      });
      if (containerId && existing.containerId !== containerId) {
        await this.identityRepository.update(
          { id: existing.id },
          { containerId },
        );
        existing.containerId = containerId;
      }
      return existing;
    }

    const dataDir = `${this.getRootDir()}/${containerName}`;
    const identity = this.identityRepository.create({
      accountId,
      containerId: input.containerId || null,
      dataDir,
      hostname: this.buildDesktopHostname(`${accountId}:${input.selfId || ''}`),
      hostnameStrategy: 'desktop-hostname-v1',
      lastLoginEvidence: null,
      macAddress: this.buildPhysicalMacAddress(accountId, containerName),
      macStrategy: 'physical-oui-v1',
      machineIdPath: `${dataDir}/machine-id`,
      verificationStatus: 'pending',
    });
    ensureSnowflakeId(identity);

    return this.identityRepository.save(identity);
  }

  /**
   * Builds the stable container directory name used for data-dir ownership.
   * @param seed - QQ self id or account id used in container path compatibility, not in the public hostname.
   */
  private buildContainerName(seed: string) {
    const prefix = this.getConfig(
      'QQBOT_NAPCAT_CONTAINER_PREFIX',
      'kt-qqbot-napcat',
    );
    const suffix = `${seed || 'unknown'}`
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .toLowerCase();
    return `${prefix}-${suffix}`.replace(/-+/g, '-').slice(0, 120);
  }

  /**
   * Builds a stable desktop-like hostname that avoids QQ numbers and container naming terms.
   * @param seed - Account/self-id seed used only for deterministic hashing, never copied into visible hostname text.
   */
  private buildDesktopHostname(seed: string) {
    const hash = createHash('sha256').update(seed).digest('hex');
    return `ubuntu-pc-${hash.slice(0, 10)}`;
  }

  /**
   * Builds a stable MAC using a physical-device-style OUI prefix.
   * @param accountId - Account id used as a deterministic seed, not as visible output.
   * @param containerName - Container name mixed into the deterministic seed.
   */
  private buildPhysicalMacAddress(accountId: string, containerName: string) {
    const hash = createHash('sha256')
      .update(`${accountId}:${containerName}:physical-oui-v1`)
      .digest('hex');
    const prefixIndex =
      Number.parseInt(hash.slice(0, 4), 16) %
      NAPCAT_PHYSICAL_OUI_PREFIXES.length;
    const prefix = NAPCAT_PHYSICAL_OUI_PREFIXES[prefixIndex];
    const suffix = [hash.slice(4, 6), hash.slice(6, 8), hash.slice(8, 10)];
    const mac = `${prefix}:${suffix.join(':')}`.toLowerCase();

    if (isRejectedVirtualMacPrefix(mac)) {
      throw new Error(`Rejected generated virtual MAC prefix: ${mac}`);
    }

    return mac;
  }

  /**
   * Migrates an existing Docker-style identity to the stable desktop profile once.
   * @param identity - Persisted identity row loaded for the account being prepared.
   * @param input - Current account/container seed used to derive deterministic target values.
   */
  private async migrateLegacyIdentityIfNeeded(
    identity: NapcatDeviceIdentity,
    input: {
      accountId: string;
      containerName: string;
      selfId: string;
    },
  ) {
    const nextHostname = this.buildDesktopHostname(
      `${input.accountId}:${input.selfId}`,
    );
    const nextMacAddress = this.buildPhysicalMacAddress(
      input.accountId,
      input.containerName,
    );
    const needsMigration =
      identity.hostname !== nextHostname ||
      isRejectedVirtualMacPrefix(identity.macAddress);

    if (!needsMigration) {
      return;
    }

    const migrationEvidence = {
      migration: {
        fromHostname: identity.hostname,
        fromMacAddress: identity.macAddress,
        strategy: 'physical-oui-v1',
        toHostname: nextHostname,
        toMacAddress: nextMacAddress,
        trigger: 'legacy-docker-identity-upgrade',
      },
    };

    await this.identityRepository.update(
      { id: identity.id },
      {
        hostname: nextHostname,
        hostnameStrategy: 'desktop-hostname-v1',
        lastLoginEvidence: migrationEvidence,
        macAddress: nextMacAddress,
        macStrategy: 'physical-oui-v1',
      },
    );
    Object.assign(identity, {
      hostname: nextHostname,
      hostnameStrategy: 'desktop-hostname-v1',
      lastLoginEvidence: migrationEvidence,
      macAddress: nextMacAddress,
      macStrategy: 'physical-oui-v1',
    });
  }

  /**
   * 查询 NapCat 登录运行态数据。
   */
  private getRootDir() {
    return this.getConfig(
      'QQBOT_NAPCAT_ROOT',
      '/vol1/docker/kt-qqbot/napcat-instances',
    ).replace(/[\\/]+$/, '');
  }

  /**
   * 查询 NapCat 登录运行态数据。
   * @param key - 键名；限定 NapCat查询范围。
   * @param defaultValue - defaultValue 输入；限定 NapCat查询范围。
   */
  private getConfig(key: string, defaultValue = '') {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }
}
