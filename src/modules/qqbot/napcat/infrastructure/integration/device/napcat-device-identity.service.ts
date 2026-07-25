import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import { NapcatDeviceIdentity } from '../../persistence/napcat-device-identity.entity';
import {
  hasPhysicalOuiMacPrefix,
  isRejectedVirtualMacPrefix,
  NAPCAT_PHYSICAL_OUI_PREFIXES,
} from '../../../domain/runtime/napcat-physical-oui-catalog';

const QQNT_VISIBLE_HOSTNAME_STRATEGY = 'qqnt-visible-hostname-v1';
const QQNT_PHYSICAL_OUI_MAC_STRATEGY = 'physical-oui-mac-v1';

type ResolveNapcatDeviceIdentityInput = {
  accountId: string;
  containerId?: string;
  selfId?: string;
};

type AdoptNapcatDeviceIdentityInput = {
  accountId: string;
  containerId: string;
  selfId?: string;
};

@Injectable()
export class NapcatDeviceIdentityService {
  constructor(
    @InjectRepository(NapcatDeviceIdentity)
    private readonly identityRepository: Repository<NapcatDeviceIdentity>,
    private readonly configService: ConfigService,
  ) {}

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
      hostname: this.buildQqntVisibleHostname(
        `${accountId}:${input.selfId || ''}`,
      ),
      hostnameStrategy: QQNT_VISIBLE_HOSTNAME_STRATEGY,
      lastLoginEvidence: null,
      macAddress: this.buildPhysicalOuiMacAddress(accountId, containerName),
      macStrategy: QQNT_PHYSICAL_OUI_MAC_STRATEGY,
      machineIdPath: `${dataDir}/machine-id`,
      verificationStatus: 'pending',
    });
    ensureSnowflakeId(identity);

    return this.identityRepository.save(identity);
  }

  async adoptContainerIdentity(input: AdoptNapcatDeviceIdentityInput) {
    const accountId = `${input.accountId}`.trim();
    const containerId = `${input.containerId}`.trim();
    const provisionalIdentity = await this.identityRepository.findOne({
      where: { containerId },
    });

    if (!provisionalIdentity) {
      return this.resolveForAccount({
        accountId,
        containerId,
        selfId: input.selfId,
      });
    }

    if (provisionalIdentity.accountId === accountId) {
      return provisionalIdentity;
    }

    const targetIdentity = await this.identityRepository.findOne({
      where: { accountId },
    });
    if (targetIdentity && targetIdentity.id !== provisionalIdentity.id) {
      return this.mergeProvisionalIdentityIntoTarget({
        accountId,
        containerId,
        provisionalIdentity,
        selfId: input.selfId,
        targetIdentity,
      });
    }

    const lastLoginEvidence = this.buildAdoptionEvidence({
      existingEvidence: provisionalIdentity.lastLoginEvidence,
      fromAccountId: provisionalIdentity.accountId,
      selfId: input.selfId,
      toAccountId: accountId,
    });
    await this.identityRepository.update(
      { id: provisionalIdentity.id },
      {
        accountId,
        containerId,
        lastLoginEvidence,
      },
    );
    Object.assign(provisionalIdentity, {
      accountId,
      containerId,
      lastLoginEvidence,
    });

    return provisionalIdentity;
  }

  private async mergeProvisionalIdentityIntoTarget(input: {
    accountId: string;
    containerId: string;
    provisionalIdentity: NapcatDeviceIdentity;
    selfId?: string;
    targetIdentity: NapcatDeviceIdentity;
  }) {
    const lastLoginEvidence = this.buildAdoptionEvidence({
      existingEvidence: input.targetIdentity.lastLoginEvidence,
      fromAccountId: input.provisionalIdentity.accountId,
      replacedIdentityId: input.provisionalIdentity.id,
      selfId: input.selfId,
      toAccountId: input.accountId,
    });
    const nextIdentity = {
      accountId: input.accountId,
      containerId: input.containerId,
      dataDir: input.provisionalIdentity.dataDir,
      hostname: input.provisionalIdentity.hostname,
      hostnameStrategy: input.provisionalIdentity.hostnameStrategy,
      lastLoginEvidence,
      machineIdPath: input.provisionalIdentity.machineIdPath,
      macAddress: input.provisionalIdentity.macAddress,
      macStrategy: input.provisionalIdentity.macStrategy,
      verificationStatus: input.provisionalIdentity.verificationStatus,
    };
    await this.identityRepository.update(
      { id: input.targetIdentity.id },
      nextIdentity,
    );
    await this.identityRepository.delete({ id: input.provisionalIdentity.id });
    Object.assign(input.targetIdentity, nextIdentity);
    return input.targetIdentity;
  }

  private buildAdoptionEvidence(input: {
    existingEvidence: null | Record<string, unknown>;
    fromAccountId: string;
    replacedIdentityId?: string;
    selfId?: string;
    toAccountId: string;
  }) {
    return {
      ...(input.existingEvidence || {}),
      adoption: {
        fromAccountId: input.fromAccountId,
        replacedIdentityId: input.replacedIdentityId || null,
        selfId: input.selfId || null,
        strategy: 'create-login-provisional-identity-adoption-v1',
        toAccountId: input.toAccountId,
      },
    };
  }

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

  private buildQqntVisibleHostname(seed: string) {
    const hash = createHash('sha256').update(seed).digest('hex');
    return `pc-${hash.slice(0, 8)}`;
  }

  private buildPhysicalOuiMacAddress(
    accountId: string,
    containerName: string,
  ) {
    const hash = createHash('sha256')
      .update(
        `${accountId}:${containerName}:${QQNT_PHYSICAL_OUI_MAC_STRATEGY}`,
      )
      .digest('hex');
    const prefix =
      NAPCAT_PHYSICAL_OUI_PREFIXES[
        parseInt(hash.slice(0, 8), 16) % NAPCAT_PHYSICAL_OUI_PREFIXES.length
      ];
    const suffix = [
      hash.slice(8, 10),
      hash.slice(10, 12),
      hash.slice(12, 14),
    ];
    return `${prefix}:${suffix.join(':')}`.toLowerCase();
  }

  private async migrateLegacyIdentityIfNeeded(
    identity: NapcatDeviceIdentity,
    input: {
      accountId: string;
      containerName: string;
      selfId: string;
    },
  ) {
    const nextHostname = this.buildQqntVisibleHostname(
      `${input.accountId}:${input.selfId}`,
    );
    const nextMacAddress = this.buildPhysicalOuiMacAddress(
      input.accountId,
      input.containerName,
    );
    const needsMigration =
      identity.hostnameStrategy !== QQNT_VISIBLE_HOSTNAME_STRATEGY ||
      identity.macStrategy !== QQNT_PHYSICAL_OUI_MAC_STRATEGY ||
      !/^pc-[a-f0-9]{8}$/.test(identity.hostname || '') ||
      !hasPhysicalOuiMacPrefix(identity.macAddress || '') ||
      isRejectedVirtualMacPrefix(identity.macAddress || '');

    if (!needsMigration) {
      return;
    }

    const migrationEvidence = {
      migration: {
        fromHostname: identity.hostname,
        fromMacAddress: identity.macAddress,
        strategy: QQNT_PHYSICAL_OUI_MAC_STRATEGY,
        toHostname: nextHostname,
        toMacAddress: nextMacAddress,
        trigger: 'qqnt-device-name-regression-repair',
      },
    };

    await this.identityRepository.update(
      { id: identity.id },
      {
        hostname: nextHostname,
        hostnameStrategy: QQNT_VISIBLE_HOSTNAME_STRATEGY,
        lastLoginEvidence: migrationEvidence,
        macAddress: nextMacAddress,
        macStrategy: QQNT_PHYSICAL_OUI_MAC_STRATEGY,
      },
    );
    Object.assign(identity, {
      hostname: nextHostname,
      hostnameStrategy: QQNT_VISIBLE_HOSTNAME_STRATEGY,
      lastLoginEvidence: migrationEvidence,
      macAddress: nextMacAddress,
      macStrategy: QQNT_PHYSICAL_OUI_MAC_STRATEGY,
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
