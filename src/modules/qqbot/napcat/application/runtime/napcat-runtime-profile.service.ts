import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NapcatRuntimeProfileSnapshot } from '../../domain/runtime/napcat-profile.types';
import { NapcatProtocolProfile } from '../../infrastructure/persistence/napcat-protocol-profile.entity';
import { NapcatRuntimeProfile } from '../../infrastructure/persistence/napcat-runtime-profile.entity';

type RecordPlannedProfilesInput = {
  accountId: string;
  containerId?: string;
  dataDir: string;
  deviceIdentity?: {
    deviceIdentityId?: string;
    hostname: string;
    hostnameStrategy?: string;
    machineInfoPath: string;
    macAddress: string;
    macStrategy?: string;
  };
  protocolProfile: {
    napcatConfigHash?: string;
    napcatConfigJson?: Record<string, unknown>;
    o3HookGrayEnabled?: boolean;
    o3HookMode?: 0 | 1;
    onebotConfigHash?: string;
    onebotConfigJson?: Record<string, unknown>;
    packetBackend?: string;
    packetServer?: string;
  };
  runtimeProfile: NapcatRuntimeProfileSnapshot;
};

type AdoptPlannedProfilesInput = {
  containerId?: string;
  deviceIdentityId?: string;
  fromAccountId?: string;
  toAccountId: string;
};

@Injectable()
export class NapcatRuntimeProfileService {
  /**
   * Initializes the profile resolver used before managed runtime script generation.
   * @param configService - Nest config provider that supplies image ref, UID/GID, shm size, and profile version.
   */
  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @InjectRepository(NapcatRuntimeProfile)
    private readonly runtimeProfileRepository?: Repository<NapcatRuntimeProfile>,
    @Optional()
    @InjectRepository(NapcatProtocolProfile)
    private readonly protocolProfileRepository?: Repository<NapcatProtocolProfile>,
  ) {}

  /**
   * Resolves the runtime profile for an account-owned NapCat container.
   * @param input - Account, container, data directory, and device identity ids that tie generated profile evidence to persistence.
   * @returns Runtime profile snapshot used by managed runtime script generation and later persistence.
   */
  resolveRuntimeProfile(input: {
    accountId: string;
    containerId?: string;
    dataDir: string;
    deviceIdentityId?: string;
  }): NapcatRuntimeProfileSnapshot {
    return {
      accountId: input.accountId,
      containerId: input.containerId,
      dataDir: input.dataDir,
      desktopProfileVersion: this.getString(
        'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION',
        'desktop-cn-v16',
      ),
      deviceIdentityId: input.deviceIdentityId,
      imageRef: this.getString('QQBOT_NAPCAT_IMAGE', ''),
      locale: 'zh_CN.UTF-8',
      persistCache: true,
      persistLocalShare: true,
      persistLogs: true,
      runtimeGid: this.getNumber('QQBOT_NAPCAT_RUNTIME_GID', 1101),
      runtimeUid: this.getNumber('QQBOT_NAPCAT_RUNTIME_UID', 1101),
      shmSize: this.getString('QQBOT_NAPCAT_SHM_SIZE', '512m'),
      timezone: 'Asia/Shanghai',
      xdgCacheHome: '/app/.cache',
      xdgConfigHome: '/app/.config',
      xdgDataHome: '/app/.local/share',
    };
  }

  /**
   * Persists the planned runtime and protocol profile after managed runtime creation succeeds.
   * @param input - Account/runtime identity, generated runtime profile, and config hashes that establish the expected state before live inspection.
   */
  async recordPlannedProfiles(input: RecordPlannedProfilesInput) {
    const accountId = `${input.accountId || ''}`.trim();
    if (!accountId) return;

    if (this.runtimeProfileRepository) {
      await this.runtimeProfileRepository.save(
        this.runtimeProfileRepository.create({
          accountId,
          baseImageDigest: null,
          containerId: input.containerId || null,
          desktopProfileVersion: input.runtimeProfile.desktopProfileVersion,
          deviceIdentityId:
            input.deviceIdentity?.deviceIdentityId ||
            input.runtimeProfile.deviceIdentityId ||
            null,
          fontconfigEvidence: null,
          hostnameStrategy:
            input.deviceIdentity?.hostnameStrategy ||
            'qqnt-visible-hostname-v1',
          imageDigest: null,
          imageRef: input.runtimeProfile.imageRef,
          lastCheckEvidence: {
            dataDir: input.dataDir,
            deviceIdentityId:
              input.deviceIdentity?.deviceIdentityId ||
              input.runtimeProfile.deviceIdentityId ||
              null,
            hostname: input.deviceIdentity?.hostname || null,
            machineInfoPath: input.deviceIdentity?.machineInfoPath || null,
            macAddress: input.deviceIdentity?.macAddress || null,
          },
          lastCheckedAt: null,
          locale: input.runtimeProfile.locale,
          localeAvailable: false,
          macStrategy: input.deviceIdentity?.macStrategy || 'physical-oui-mac-v1',
          migrateDeviceIdentity: !!input.deviceIdentity,
          persistCache: input.runtimeProfile.persistCache,
          persistLocalShare: input.runtimeProfile.persistLocalShare,
          persistLogs: input.runtimeProfile.persistLogs,
          profileStatus: 'pending',
          profileVersion: this.getString(
            'QQBOT_NAPCAT_PROFILE_VERSION',
            'napcat-runtime-profile-v1',
          ),
          runtimeGid: input.runtimeProfile.runtimeGid,
          runtimeUid: input.runtimeProfile.runtimeUid,
          shmSize: input.runtimeProfile.shmSize,
          timezoneEvidence: {
            expectedTimezone: input.runtimeProfile.timezone,
          },
          xdgCacheHome: input.runtimeProfile.xdgCacheHome,
          xdgConfigHome: input.runtimeProfile.xdgConfigHome,
          xdgDataHome: input.runtimeProfile.xdgDataHome,
        }),
      );
    }

    if (this.protocolProfileRepository) {
      await this.protocolProfileRepository.save(
        this.protocolProfileRepository.create({
          accountId,
          containerId: input.containerId || null,
          lastCheckEvidence: {
            configSource: 'managed-create-script',
          },
          lastCheckedAt: null,
          napcatConfigHash: input.protocolProfile.napcatConfigHash || null,
          napcatConfigJson: input.protocolProfile.napcatConfigJson || null,
          o3HookGrayEnabled: !!input.protocolProfile.o3HookGrayEnabled,
          o3HookMode: input.protocolProfile.o3HookMode ?? 0,
          onebotConfigHash: input.protocolProfile.onebotConfigHash || null,
          onebotConfigJson: input.protocolProfile.onebotConfigJson || null,
          packetBackend: input.protocolProfile.packetBackend || 'auto',
          packetServer: input.protocolProfile.packetServer || '',
          profileStatus: 'pending',
          profileVersion: this.getString(
            'QQBOT_NAPCAT_PROTOCOL_PROFILE_VERSION',
            'napcat-protocol-profile-v1',
          ),
        }),
      );
    }
  }

  /**
   * Moves planned create-login runtime evidence from a provisional account seed to the scanned account.
   * @param input - Target account id plus the reserved container/provisional account id used before QQ self id was known.
   */
  async adoptPlannedProfiles(input: AdoptPlannedProfilesInput) {
    const toAccountId = `${input.toAccountId || ''}`.trim();
    const fromAccountId =
      `${input.fromAccountId || input.containerId || ''}`.trim();
    const containerId = `${input.containerId || ''}`.trim();
    if (!toAccountId || !fromAccountId) return;

    if (this.runtimeProfileRepository) {
      await this.runtimeProfileRepository.update(
        this.buildProfileAdoptionWhere(fromAccountId, containerId),
        {
          accountId: toAccountId,
          containerId: containerId || null,
          deviceIdentityId: input.deviceIdentityId || null,
        },
      );
    }

    if (this.protocolProfileRepository) {
      await this.protocolProfileRepository.update(
        this.buildProfileAdoptionWhere(fromAccountId, containerId),
        {
          accountId: toAccountId,
          containerId: containerId || null,
        },
      );
    }
  }

  /**
   * Builds the narrow update condition for provisional profile adoption.
   * @param fromAccountId - Temporary account id used during first container startup, usually the reserved container id.
   * @param containerId - Reserved container id; included when present so unrelated historical rows are untouched.
   * @returns TypeORM partial where object used by both runtime and protocol profile repositories.
   */
  private buildProfileAdoptionWhere(
    fromAccountId: string,
    containerId: string,
  ) {
    return containerId
      ? {
          accountId: fromAccountId,
          containerId,
        }
      : { accountId: fromAccountId };
  }

  /**
   * Reads a trimmed string config value for profile generation.
   * @param key - Environment key that controls NapCat runtime profile generation.
   * @param defaultValue - Value used when the key is absent from runtime config.
   * @returns Trimmed string value consumed by managed runtime script generation.
   */
  private getString(key: string, defaultValue: string) {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }

  /**
   * Reads a positive numeric config value for UID/GID profile fields.
   * @param key - Environment key that should contain a numeric UID/GID value.
   * @param defaultValue - Safe non-root fallback for profile generation.
   * @returns Positive integer used as the container runtime UID/GID.
   */
  private getNumber(key: string, defaultValue: number) {
    const value = Number(this.configService.get<string>(key) || defaultValue);
    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }
}
