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

  /** 构建检查脚本。 */
  buildInspectScript(containerName: string) {
    return this.inspectionScriptService.buildInspectScript(containerName);
  }

  /** 清理证据。 */
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

  /** 读取账号运行态详情。 */
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

  /** 读取账号运行态摘要映射。 */
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

  /** 读取检查超时毫秒。 */
  private getInspectionTimeoutMs() {
    const value = Number(
      this.configService.get<string>(
        'QQBOT_NAPCAT_PROFILE_INSPECT_TIMEOUT_MS',
      ) || 15_000,
    );
    return Number.isFinite(value) && value > 0 ? value : 15_000;
  }

  /** 返回到资料状态。 */
  private toProfileStatus(
    status?: string,
  ): NapcatRuntimeProfileSummary['profileStatus'] {
    if (status === 'synced') return 'ok';
    if (status === 'drifted') return 'drift';
    if (status === 'failed') return 'failed';
    return 'unknown';
  }

  /** 返回脱敏字符串。 */
  private redactString(value: string) {
    return value.replace(/token=[^&\s]+/gi, 'token=[REDACTED]');
  }
}
