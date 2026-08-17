import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ToolsService } from '@/common';
import { NapcatRuntimeProfileInspectionScriptService } from '../../infrastructure/integration/container/napcat-runtime-profile-inspection-script.service';
import { NapcatProtocolProfile } from '../../infrastructure/persistence/napcat-protocol-profile.entity';
import { NapcatRuntimeProfile } from '../../infrastructure/persistence/napcat-runtime-profile.entity';

export type NapcatRuntimeProfileSummary = {
  profileStatus?: 'drift' | 'failed' | 'ok' | 'unknown';
  recoveryState?: 'idle' | 'password' | 'quick' | 'suspended';
  riskMode?: 'cooldown' | 'manual_only' | 'normal';
  runtimeProfile?: {
    desktopProfileVersion?: string;
    imageDigest?: string;
    imageRef?: string;
    locale?: string;
    shmSize?: string;
  };
};

@Injectable()
export class NapcatRuntimeProfileInspectorService {
  constructor(
    @InjectRepository(NapcatRuntimeProfile)
    private readonly runtimeProfileRepository: Repository<NapcatRuntimeProfile>,
    @InjectRepository(NapcatProtocolProfile)
    private readonly protocolProfileRepository: Repository<NapcatProtocolProfile>,
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly inspectionScriptService?: NapcatRuntimeProfileInspectionScriptService,
  ) {
    this.inspectionScriptService =
      inspectionScriptService ||
      new NapcatRuntimeProfileInspectionScriptService();
  }

  /**
   * 根据`containerName`构造检查脚本。
   * @param containerName - 决定检查脚本内容、边界或目标的 `containerName` 值。
   * @returns 检查脚本。
   */
  buildInspectScript(containerName: string) {
    return this.inspectionScriptService.buildInspectScript(containerName);
  }

  /**
   * 将`value`规范为证据，使等价输入得到一致表示；当 `Array.isArray(value)` 成立时返回 `value.map((item) => this.sanitizeEvidence(i…`。
   * @param value - 参与证据比较、格式化或输出的候选值。
   * @returns 证据。
   */
  sanitizeEvidence(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeEvidence(item));
    }

    if (typeof value === 'string') return this.redactString(value);

    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (/password|token|secret|private[-_]?key/i.test(key)) {
          return [key, '[REDACTED]'];
        }
        return [key, this.sanitizeEvidence(item)];
      }),
    );
  }

  /**
   * 按`accountId`读取账号运行态详情；从 `runtimeProfileRepository.findOne` 读取账号运行态详情。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 包含 `accountId`、`inspectionTimeoutMs`、`protocolProfile`、`runtimeProfile` 字段的账号运行态详情。
   */
  async getAccountRuntimeDetail(accountId: string) {
    const normalizedAccountId = this.toolsService.toTrimmedString(accountId);
    const [runtimeProfile, protocolProfile] = await Promise.all([
      this.runtimeProfileRepository.findOne({
        order: { updateTime: 'DESC' },
        where: { accountId: normalizedAccountId },
      }),
      this.protocolProfileRepository.findOne({
        order: { updateTime: 'DESC' },
        where: { accountId: normalizedAccountId },
      }),
    ]);

    return {
      accountId: normalizedAccountId,
      inspectionTimeoutMs: this.getInspectionTimeoutMs(),
      protocolProfile: this.sanitizeEvidence(protocolProfile),
      runtimeProfile: this.sanitizeEvidence(runtimeProfile),
    };
  }

  /**
   * 按`accountIds`读取账号运行态摘要映射；同步更新对应缓存或去重状态（`summaryMap.set`）。
   * @param accountIds - 要批量读取、校验或更新的账号标识集合。
   * @returns 账号运行态摘要映射。
   */
  async getAccountRuntimeSummaryMap(accountIds: string[]) {
    const normalizedIds = accountIds
      .map((accountId) => this.toolsService.toTrimmedString(accountId))
      .filter(Boolean);
    const summaryMap = new Map<string, NapcatRuntimeProfileSummary>();
    if (normalizedIds.length <= 0) return summaryMap;

    const profiles = await this.runtimeProfileRepository.find({
      order: { updateTime: 'DESC' },
      where: { accountId: In(normalizedIds) },
    });

    for (const profile of profiles) {
      if (summaryMap.has(profile.accountId)) continue;
      summaryMap.set(profile.accountId, {
        profileStatus: this.toProfileStatus(profile.profileStatus),
        recoveryState: 'idle',
        runtimeProfile: {
          desktopProfileVersion: profile.desktopProfileVersion || undefined,
          imageDigest: profile.imageDigest || undefined,
          imageRef: profile.imageRef || undefined,
          locale: profile.locale || undefined,
          shmSize: profile.shmSize || undefined,
        },
      });
    }

    return summaryMap;
  }

  /**
   * 按当前运行态读取检查超时毫秒；当 `Number.isFinite(value) && value > 0` 成立时返回 `value`。
   * @returns 当前状态对应的检查超时毫秒，取值为 `15_000`。
   */
  private getInspectionTimeoutMs() {
    const value = Number(
      this.configService.get<string>(
        'QQBOT_NAPCAT_PROFILE_INSPECT_TIMEOUT_MS',
      ) || 15_000,
    );
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return 15_000;
  }

  /**
   * 把配置档案同步状态映射为健康状态，未知输入回退为 `unknown`。
   * @param status - 决定把配置档案同步状态映射为健康状态，未知输入回退为 `unknown`内容、边界或目标的 `status` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 返回 `ok`、`drift`、`failed` 或 `unknown`；未知状态回退为 `unknown`。
   */
  private toProfileStatus(
    status?: string,
  ): NapcatRuntimeProfileSummary['profileStatus'] {
    if (status === 'synced') return 'ok';
    if (status === 'drifted') return 'drift';
    if (status === 'failed') return 'failed';
    return 'unknown';
  }

  /**
   * 按边界规则转换脱敏字符串。
   * @param value - 参与按边界规则转换脱敏字符串比较、格式化或输出的候选值。
   * @returns 按边界规则转换脱敏字符串。
   */
  private redactString(value: string) {
    return value.replace(/token=[^&\s]+/gi, 'token=[REDACTED]');
  }
}
