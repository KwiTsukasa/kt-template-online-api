import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import type {
  QqbotNapcatRuntime,
  QqbotNapcatWebuiStatus,
} from '@/modules/qqbot/core/contract/qqbot.types';
import { QqbotNapcatContainerService } from '../../infrastructure/integration/container/qqbot-napcat-container.service';
import { NapcatWebuiGatewayAudit } from '../infrastructure/persistence/napcat-webui-gateway-audit.entity';
import {
  QqbotNapcatWebuiGatewayClient,
  type QqbotNapcatWebuiGatewayLifecycleResult,
} from '../infrastructure/qqbot-napcat-webui-gateway.client';
import type { QqbotNapcatWebuiSessionResponseDto } from '../contract/qqbot-napcat-webui-gateway.dto';

const SENSITIVE_DETAIL_KEY_PATTERN =
  /^(baseurl|captcha|captchaticket|credential|credentialheader|dockerip|headers|hostport|internalsecret|naspath|nasroute|password|qrpayload|qrcode|rawheaders|secret|targetbaseurl|ticket|token|upstreambaseurl|upstreamurl|webuiport|webuitoken)$/i;
const SENSITIVE_DETAIL_KEY_FAMILIES = [
  'authorization',
  'captcha',
  'cookie',
  'credential',
  'password',
  'secret',
  'ticket',
  'token',
];
const SENSITIVE_DETAIL_KEY_SUBSTRINGS = [
  'dockerip',
  'hostport',
  'naspath',
  'nasroute',
  'targetbaseurl',
  'upstreambaseurl',
  'upstreamurl',
  'webuiport',
  'webuitoken',
];
const UNSAFE_DETAIL_STRING_PATTERN =
  /(\bBearer\s+\S+|\bCredential\b|(?:^|[?&\s])(token|ticket|secret|password|credential|captcha)=|webui[_-]?token|https?:\/\/(?:127\.0\.0\.1|localhost|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|[^/\s]*:\d+)|\/internal\/sessions\b|\bnas(?:route|path)?\b|\/vol\d\b|\bdocker[_-]?ip\b)/i;
const REDACTED_DETAIL_VALUE = '[REDACTED]';
const ACCOUNT_ID_PATTERN = /^[1-9]\d{0,31}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type QqbotNapcatWebuiGatewaySessionCreateInput = {
  accountId: string;
  adminUserId: string;
  clientIp?: string | null;
  userAgent?: string | null;
};

export type QqbotNapcatWebuiGatewaySessionLifecycleInput = {
  adminUserId: string;
  clientIp?: string | null;
  sessionId: string;
  userAgent?: string | null;
};

export type NapcatWebuiGatewayAuditRecordInput = {
  accountId: string;
  adminUserId: string;
  clientIp?: string | null;
  containerId: string;
  detailJson?: null | Record<string, unknown>;
  eventType: string;
  selfId: string;
  sessionId: string;
  userAgent?: string | null;
};

@Injectable()
export class NapcatWebuiGatewayAuditService {
  /**
   * Creates the audit recorder for browser Gateway session lifecycle evidence.
   * @param auditRepository - TypeORM repository for sanitized WebUI Gateway audit rows.
   */
  constructor(
    @InjectRepository(NapcatWebuiGatewayAudit)
    private readonly auditRepository: Repository<NapcatWebuiGatewayAudit>,
  ) {}

  /**
   * Persists one sanitized Gateway audit event.
   * @param input - Event identity, actor, client evidence, and already-safe detail fields.
   * @returns Saved audit entity.
   */
  async record(input: NapcatWebuiGatewayAuditRecordInput) {
    const entity = this.auditRepository.create({
      accountId: input.accountId,
      adminUserId: input.adminUserId,
      clientIp: this.toNullableText(input.clientIp, 128),
      containerId: input.containerId,
      detailJson: this.sanitizeDetail(input.detailJson),
      eventType: input.eventType,
      selfId: input.selfId,
      sessionId: input.sessionId,
      userAgent: this.toNullableText(input.userAgent, 512),
    });

    return this.auditRepository.save(entity);
  }

  /**
   * Removes known secret-bearing keys from nested audit detail objects.
   * @param detail - Candidate detail payload supplied by the application service.
   * @returns Sanitized detail object or null when no detail is supplied.
   */
  private sanitizeDetail(detail?: null | Record<string, unknown>) {
    if (!detail) return null;
    return this.sanitizeValue(detail) as Record<string, unknown>;
  }

  /**
   * Recursively sanitizes arrays and objects without preserving sensitive keys.
   * @param value - Arbitrary audit detail value.
   * @returns Value safe to serialize into the audit table.
   */
  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (typeof value === 'string') {
      return this.isUnsafeDetailString(value) ? REDACTED_DETAIL_VALUE : value;
    }
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !this.isSensitiveDetailKey(key))
        .map(([key, item]) => [key, this.sanitizeValue(item)]),
    );
  }

  /**
   * Normalizes key style variants before checking whether a field can carry secrets.
   * @param key - Raw object key from audit detail.
   * @returns Whether the key should be dropped from persisted audit JSON.
   */
  private isSensitiveDetailKey(key: string) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      SENSITIVE_DETAIL_KEY_PATTERN.test(normalized) ||
      SENSITIVE_DETAIL_KEY_FAMILIES.some((family) =>
        normalized.includes(family),
      ) ||
      SENSITIVE_DETAIL_KEY_SUBSTRINGS.some((substring) =>
        normalized.includes(substring),
      )
    );
  }

  /**
   * Detects secret-bearing string values that should never be persisted in audit detail.
   * @param value - Raw string value from audit detail.
   * @returns Whether the value should be replaced with a redaction marker.
   */
  private isUnsafeDetailString(value: string) {
    return UNSAFE_DETAIL_STRING_PATTERN.test(value);
  }

  /**
   * Converts optional client evidence into a bounded nullable column value.
   * @param value - Raw IP or user-agent value from the request.
   * @param limit - Database column length limit.
   * @returns Trimmed string or null for empty input.
   */
  private toNullableText(value: null | string | undefined, limit: number) {
    const text = String(value || '').trim();
    return text ? text.slice(0, limit) : null;
  }
}

@Injectable()
export class QqbotNapcatWebuiGatewayService {
  /**
   * Creates the Admin-facing WebUI Gateway application service.
   * @param accountService - QQBot account reader used to validate and serialize account identity.
   * @param containerService - NapCat runtime resolver that supplies server-only WebUI target data.
   * @param gatewayClient - Internal Gateway client used for session lifecycle requests.
   * @param auditService - Sanitized audit recorder for Admin session events.
   */
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly containerService: QqbotNapcatContainerService,
    private readonly gatewayClient: QqbotNapcatWebuiGatewayClient,
    private readonly auditService: NapcatWebuiGatewayAuditService,
  ) {}

  /**
   * Creates a browser-safe WebUI Gateway session for one QQBot account.
   * @param input - Admin actor, client evidence, and target QQBot account id.
   * @returns Browser-safe session response without WebUI token, upstream URL, or port.
   */
  async createSession(
    input: QqbotNapcatWebuiGatewaySessionCreateInput,
  ): Promise<QqbotNapcatWebuiSessionResponseDto> {
    const accountId = this.requireAccountId(input.accountId);
    const account = await this.accountService.findById(accountId);
    if (!account) {
      throwVbenError('QQBot 账号不存在');
    }

    const runtime = await this.containerService.findPrimaryContainerByAccountId(
      account.id,
    );
    if (!runtime?.id) {
      throwVbenError('账号未绑定 NapCat 容器');
    }
    if (runtime.sourceContainerOnline !== true) {
      throwVbenError('NapCat WebUI 不在线');
    }

    const target = this.toGatewayTarget(runtime);
    const gatewaySession = await this.gatewayClient.createSession({
      accountId: account.id,
      adminUserId: input.adminUserId,
      clientIp: input.clientIp || undefined,
      containerId: runtime.id,
      containerName: runtime.name,
      selfId: account.selfId,
      userAgent: input.userAgent || undefined,
      ...target,
    });
    const webuiStatus = this.toWebuiStatus(runtime);

    await this.auditService.record({
      accountId: account.id,
      adminUserId: input.adminUserId,
      clientIp: input.clientIp,
      containerId: runtime.id,
      detailJson: {
        accountName: account.name,
        containerName: runtime.name,
        webuiStatus,
      },
      eventType: 'session.create',
      selfId: account.selfId,
      sessionId: gatewaySession.sessionId,
      userAgent: input.userAgent,
    });

    return {
      account: {
        id: account.id,
        name: account.name,
        selfId: account.selfId,
      },
      container: {
        id: runtime.id,
        name: runtime.name,
        webuiStatus,
      },
      expiresAt: gatewaySession.expiresAt,
      iframeUrl: gatewaySession.iframeUrl,
      sessionId: gatewaySession.sessionId,
    };
  }

  /**
   * Forwards a Gateway heartbeat for an existing Admin WebUI session.
   * @param input - Gateway session id plus Admin actor and request evidence.
   * @returns Gateway lifecycle response.
   */
  heartbeat(
    input: QqbotNapcatWebuiGatewaySessionLifecycleInput,
  ): Promise<QqbotNapcatWebuiGatewayLifecycleResult> {
    return this.gatewayClient.heartbeat({
      adminUserId: input.adminUserId,
      clientIp: input.clientIp || undefined,
      sessionId: this.requireSessionId(input.sessionId),
      userAgent: input.userAgent || undefined,
    });
  }

  /**
   * Revokes an existing Admin WebUI Gateway session.
   * @param input - Gateway session id plus Admin actor and request evidence.
   * @returns Gateway lifecycle response.
   */
  revoke(
    input: QqbotNapcatWebuiGatewaySessionLifecycleInput,
  ): Promise<QqbotNapcatWebuiGatewayLifecycleResult> {
    return this.gatewayClient.revoke({
      adminUserId: input.adminUserId,
      clientIp: input.clientIp || undefined,
      sessionId: this.requireSessionId(input.sessionId),
      userAgent: input.userAgent || undefined,
    });
  }

  /**
   * Validates a QQBot account id before querying persistence or container state.
   * @param accountId - Candidate account id supplied by Admin.
   * @returns Trimmed account id.
   */
  private requireAccountId(accountId: string) {
    const normalized = String(accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(normalized)) {
      throwVbenError('QQBot 账号ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * Validates a Gateway session id before forwarding lifecycle calls.
   * @param sessionId - Candidate session id from the Admin route.
   * @returns Trimmed Gateway session id.
   */
  private requireSessionId(sessionId: string) {
    const normalized = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(normalized)) {
      throwVbenError('Gateway 会话ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * Converts private NapCat runtime fields into the Gateway client payload.
   * @param runtime - Primary NapCat runtime containing upstream URL, port, and WebUI token.
   * @returns Internal-only Gateway target metadata without exposing the raw WebUI port separately.
   */
  private toGatewayTarget(runtime: QqbotNapcatRuntime) {
    const upstreamBaseUrl = String(runtime.baseUrl || '').trim();
    const webuiToken = String(runtime.webuiToken || '').trim();
    const webuiPort = Number(runtime.webuiPort);

    if (!upstreamBaseUrl || !webuiToken || !Number.isFinite(webuiPort)) {
      throwVbenError('NapCat WebUI 配置不完整');
    }
    if (webuiPort <= 0) {
      throwVbenError('NapCat WebUI 配置不完整');
    }

    return {
      upstreamBaseUrl,
      webuiToken,
    };
  }

  /**
   * Maps runtime evidence to the browser-safe WebUI status field.
   * @param runtime - Primary NapCat runtime with container online evidence.
   * @returns Browser-safe WebUI status string.
   */
  private toWebuiStatus(
    runtime: QqbotNapcatRuntime,
  ): QqbotNapcatWebuiStatus {
    return runtime.sourceContainerOnline ? 'online' : 'offline';
  }
}
