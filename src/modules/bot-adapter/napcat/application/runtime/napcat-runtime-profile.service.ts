import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ensureSnowflakeId } from '@/common';
import { ObjectLiteral, Repository } from 'typeorm';
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
   * 从`input`解析运行态资料；从 `getString` 读取运行态资料。
   * @param input - 用于运行态资料的结构化输入，包含 `accountId`、`containerId`、`dataDir`、`deviceIdentityId` 字段。
   * @returns 包含 `accountId`、`containerId`、`dataDir`、`desktopProfileVersion`、`deviceIdentityId` 字段的运行态资料。
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
        'NAPCAT_DESKTOP_PROFILE_VERSION',
        'desktop-cn-v21',
      ),
      deviceIdentityId: input.deviceIdentityId,
      imageRef: this.getString('NAPCAT_IMAGE', ''),
      locale: 'zh_CN.UTF-8',
      persistCache: true,
      persistLocalShare: true,
      persistLogs: true,
      runtimeGid: this.getNumber('NAPCAT_RUNTIME_GID', 1101),
      runtimeUid: this.getNumber('NAPCAT_RUNTIME_UID', 1101),
      shmSize: this.getString('NAPCAT_SHM_SIZE', '512m'),
      timezone: 'Asia/Shanghai',
      xdgCacheHome: '/app/.cache',
      xdgConfigHome: '/app/.config',
      xdgDataHome: '/app/.local/share',
    };
  }

  /**
   * 根据`input`处理记录已规划的配置档案；把变更持久化到当前存储（`runtimeProfileRepository.create`）。
   * @param input - 用于记录已规划的配置档案的结构化输入，包含 `accountId`、`containerId`、`runtimeProfile`、`deviceIdentity` 字段。
   */
  async recordPlannedProfiles(input: RecordPlannedProfilesInput) {
    const accountId = `${input.accountId || ''}`.trim();
    const containerId = `${input.containerId || ''}`.trim();
    if (!accountId) return;

    if (this.runtimeProfileRepository) {
      await this.saveProfile(
        this.runtimeProfileRepository,
        this.runtimeProfileRepository.create({
          accountId,
          baseImageDigest: null,
          containerId: containerId || null,
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
          macStrategy:
            input.deviceIdentity?.macStrategy || 'physical-oui-mac-v1',
          migrateDeviceIdentity: !!input.deviceIdentity,
          persistCache: input.runtimeProfile.persistCache,
          persistLocalShare: input.runtimeProfile.persistLocalShare,
          persistLogs: input.runtimeProfile.persistLogs,
          profileStatus: 'pending',
          profileVersion: this.getString(
            'NAPCAT_PROFILE_VERSION',
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
      await this.saveProfile(
        this.protocolProfileRepository,
        this.protocolProfileRepository.create({
          accountId,
          containerId: containerId || null,
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
            'NAPCAT_PROTOCOL_PROFILE_VERSION',
            'napcat-protocol-profile-v1',
          ),
        }),
      );
    }
  }

  /**
   * 根据`input`处理接管已规划的配置档案；把变更持久化到当前存储（`runtimeProfileRepository.update`）。
   * @param input - 用于接管已规划的配置档案的结构化输入，包含 `toAccountId`、`fromAccountId`、`containerId`、`deviceIdentityId` 字段。
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
   * 构建资料接管位置，并输出固定投影 `accountId`、`containerId` 字段。
   * @param fromAccountId - 用于精确定位账号的标识。
   * @param containerId - 用于精确定位容器的标识。
   * @returns 包含 `accountId` 字段的资料AdoptionWhere。
   */
  private buildProfileAdoptionWhere(
    fromAccountId: string,
    containerId: string,
  ) {
    if (containerId) {
      return {
          accountId: fromAccountId,
          containerId,
        };
    }
    return { accountId: fromAccountId };
  }

  /**
   * 根据`repository`、`profile`更新资料；当 `!profile.containerId` 成立时直接结束且不产生返回值。
   * @param repository - 负责查询或持久化资料的仓库实例。
   * @param profile - 用于资料的领域对象，包含 `containerId` 字段。
   */
  private async saveProfile<
    T extends ObjectLiteral & { containerId: null | string; id: string },
  >(repository: Repository<T>, profile: T) {
    if (!profile.containerId) {
      await repository.save(profile);
      return;
    }

    ensureSnowflakeId(profile);
    const overwriteColumns = repository.metadata.columns
      .filter(
        (column) =>
          !column.isPrimary &&
          !column.isCreateDate &&
          column.propertyName !== 'containerId',
      )
      .map((column) => column.databaseName);

    await repository
      .createQueryBuilder()
      .insert()
      .values(profile)
      .orUpdate(overwriteColumns, ['container_id'])
      .execute();
  }

  /**
   * 读取 NapCat 运行档案的文本配置，缺失或空值使用默认值并统一去除两端空白。
   * @param key - 要从配置服务读取的运行档案配置键。
   * @param defaultValue - 配置缺失或为空时采用的默认文本。
   * @returns 去除两端空白后的配置值或默认值。
   */
  private getString(key: string, defaultValue: string) {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }

  /**
   * 读取正数配置；值不是有限正数时返回调用方提供的默认值。
   * @param key - 用于读取或更新正数配置的稳定键。
   * @param defaultValue - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 返回有效的正数配置；缺失或非法时返回 `defaultValue`。
   */
  private getNumber(key: string, defaultValue: number) {
    const value = Number(this.configService.get<string>(key) || defaultValue);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return defaultValue;
  }
}
