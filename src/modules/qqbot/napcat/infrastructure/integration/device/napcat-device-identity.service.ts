import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import { NapcatDeviceIdentity } from '../../persistence/napcat-device-identity.entity';

const QQNT_VISIBLE_HOSTNAME_STRATEGY = 'qqnt-visible-hostname-v1';
const QQNT_DOCKER_BRIDGE_MAC_STRATEGY = 'docker-bridge-mac-v1';

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
      hostname: this.buildQqntVisibleHostname(
        `${accountId}:${input.selfId || ''}`,
      ),
      hostnameStrategy: QQNT_VISIBLE_HOSTNAME_STRATEGY,
      lastLoginEvidence: null,
      macAddress: this.buildDockerBridgeMacAddress(accountId, containerName),
      macStrategy: QQNT_DOCKER_BRIDGE_MAC_STRATEGY,
      machineIdPath: `${dataDir}/machine-id`,
      verificationStatus: 'pending',
    });
    ensureSnowflakeId(identity);

    return this.identityRepository.save(identity);
  }

  /**
   * Reassigns a create-login provisional identity to the scanned account without changing visible device values.
   * @param input - Final account id and container id; container id selects the provisional identity created before QQ self id was known.
   * @returns Existing provisional identity after adoption, or a newly resolved account identity when no provisional row exists.
   */
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

  /**
   * Copies first-run device values into an existing account identity and removes the temporary row.
   * @param input - Existing target row plus the provisional row created before the scanned QQ account was known.
   * @returns Target account identity after it has adopted the running container's visible device values.
   */
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

  /**
   * Builds evidence for the one-time provisional identity adoption after a create-login scan succeeds.
   * @param input - Source/target ids and optional QQ self id used to make later audits explain the ownership change.
   * @returns JSON-safe evidence merged into the device identity row before returning it to the container binding.
   */
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
   * Builds a short stable hostname that survives the upstream Docker entrypoint rewrite and remains visible to QQNT.
   * @param seed - Account/self-id seed used only for deterministic hashing, never copied into visible hostname text.
   */
  private buildQqntVisibleHostname(seed: string) {
    const hash = createHash('sha256').update(seed).digest('hex');
    return `pc-${hash.slice(0, 8)}`;
  }

  /**
   * Builds a stable Docker bridge MAC that can be mirrored into QQNT machine-info.
   * @param accountId - Account id used as a deterministic seed, not as visible output.
   * @param containerName - Container name mixed into the deterministic seed.
   */
  private buildDockerBridgeMacAddress(
    accountId: string,
    containerName: string,
  ) {
    const hash = createHash('sha256')
      .update(
        `${accountId}:${containerName}:${QQNT_DOCKER_BRIDGE_MAC_STRATEGY}`,
      )
      .digest('hex');
    const suffix = [
      hash.slice(0, 2),
      hash.slice(2, 4),
      hash.slice(4, 6),
      hash.slice(6, 8),
    ];
    return `02:42:${suffix.join(':')}`.toLowerCase();
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
    const nextHostname = this.buildQqntVisibleHostname(
      `${input.accountId}:${input.selfId}`,
    );
    const nextMacAddress = this.buildDockerBridgeMacAddress(
      input.accountId,
      input.containerName,
    );
    const needsMigration =
      identity.hostnameStrategy !== QQNT_VISIBLE_HOSTNAME_STRATEGY ||
      identity.macStrategy !== QQNT_DOCKER_BRIDGE_MAC_STRATEGY ||
      !/^pc-[a-f0-9]{8}$/.test(identity.hostname || '') ||
      !/^02:42:([0-9a-f]{2}:){3}[0-9a-f]{2}$/i.test(identity.macAddress || '');

    if (!needsMigration) {
      return;
    }

    const migrationEvidence = {
      migration: {
        fromHostname: identity.hostname,
        fromMacAddress: identity.macAddress,
        strategy: QQNT_DOCKER_BRIDGE_MAC_STRATEGY,
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
        macStrategy: QQNT_DOCKER_BRIDGE_MAC_STRATEGY,
      },
    );
    Object.assign(identity, {
      hostname: nextHostname,
      hostnameStrategy: QQNT_VISIBLE_HOSTNAME_STRATEGY,
      lastLoginEvidence: migrationEvidence,
      macAddress: nextMacAddress,
      macStrategy: QQNT_DOCKER_BRIDGE_MAC_STRATEGY,
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
