import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ToolsService } from '@/common';
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
  /**
   * Initializes runtime inspection over the existing SSH-managed container model.
   * @param runtimeProfileRepository - Runtime profile repository updated with latest Docker and desktop evidence.
   * @param protocolProfileRepository - Protocol profile repository updated with config hashes and drift state.
   * @param configService - Runtime config provider used for SSH target and inspection timeout defaults.
   * @param toolsService - Shared helper used to normalize string evidence before redaction.
   */
  constructor(
    @InjectRepository(NapcatRuntimeProfile)
    private readonly runtimeProfileRepository: Repository<NapcatRuntimeProfile>,
    @InjectRepository(NapcatProtocolProfile)
    private readonly protocolProfileRepository: Repository<NapcatProtocolProfile>,
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * Builds the remote inspection script for Docker and in-container profile evidence.
   * @param containerName - Docker container name selected from the persisted NapCat container row.
   * @returns Shell script that collects runtime evidence without reading secret env values.
   */
  buildInspectScript(containerName: string) {
    return `
set -eu
NAME=${this.sh(containerName)}
docker inspect "$NAME"
docker exec "$NAME" sh -lc 'locale -a; locale; date +%Z; fc-match "Noto Sans CJK SC"; test ! -e /.dockerenv; cat /proc/1/cgroup; id; ps -eo user,args | grep -E "qq|NapCat|Xvfb" | grep -v grep || true'
`;
  }

  /**
   * Redacts secrets before evidence is stored, logged, or returned to Admin.
   * @param value - Evidence object or primitive produced by Docker, NapCat, or config writers.
   * @returns Evidence with sensitive keys and token query values replaced by placeholders.
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
   * Returns sanitized runtime and protocol profile detail for one account.
   * @param accountId - Account id used to locate profile rows for the Admin detail view.
   * @returns Sanitized profile evidence suitable for API responses.
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
   * Loads lightweight runtime-profile summaries for account list rows.
   * @param accountIds - Account ids from the current list page.
   * @returns Map keyed by account id with optional runtime profile summary.
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
   * Reads the bounded runtime profile inspection timeout.
   * @returns Positive timeout in milliseconds for future SSH inspection calls.
   */
  private getInspectionTimeoutMs() {
    const value = Number(
      this.configService.get<string>(
        'QQBOT_NAPCAT_PROFILE_INSPECT_TIMEOUT_MS',
      ) || 15_000,
    );
    return Number.isFinite(value) && value > 0 ? value : 15_000;
  }

  /**
   * Converts persisted profile status into the account-list API vocabulary.
   * @param status - Runtime profile persistence status from the latest profile row.
   * @returns Compact status label consumed by Admin list rows.
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
   * Redacts token query values from URL-like evidence strings.
   * @param value - Evidence string that may include token query parameters.
   * @returns String with token values replaced by `[REDACTED]`.
   */
  private redactString(value: string) {
    return value.replace(/token=[^&\s]+/gi, 'token=[REDACTED]');
  }

  /**
   * Quotes shell literals used by read-only inspection scripts.
   * @param value - Container name selected from trusted persistence.
   * @returns POSIX-safe single-quoted shell literal.
   */
  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }
}
