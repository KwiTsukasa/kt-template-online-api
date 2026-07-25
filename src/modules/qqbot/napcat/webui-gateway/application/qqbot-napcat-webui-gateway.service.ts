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
  constructor(
    @InjectRepository(NapcatWebuiGatewayAudit)
    private readonly auditRepository: Repository<NapcatWebuiGatewayAudit>,
  ) {}

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

  private sanitizeDetail(detail?: null | Record<string, unknown>) {
    if (!detail) return null;
    return this.sanitizeValue(detail) as Record<string, unknown>;
  }

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

  private isUnsafeDetailString(value: string) {
    return UNSAFE_DETAIL_STRING_PATTERN.test(value);
  }

  private toNullableText(value: null | string | undefined, limit: number) {
    const text = String(value || '').trim();
    return text ? text.slice(0, limit) : null;
  }
}

@Injectable()
export class QqbotNapcatWebuiGatewayService {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly containerService: QqbotNapcatContainerService,
    private readonly gatewayClient: QqbotNapcatWebuiGatewayClient,
    private readonly auditService: NapcatWebuiGatewayAuditService,
  ) {}

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
        webuiStatus,
      },
      expiresAt: gatewaySession.expiresAt,
      iframeUrl: gatewaySession.iframeUrl,
      sessionId: gatewaySession.sessionId,
    };
  }

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

  private requireAccountId(accountId: string) {
    const normalized = String(accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(normalized)) {
      throwVbenError('QQBot 账号ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private requireSessionId(sessionId: string) {
    const normalized = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(normalized)) {
      throwVbenError('Gateway 会话ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

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

  private toWebuiStatus(
    runtime: QqbotNapcatRuntime,
  ): QqbotNapcatWebuiStatus {
    return runtime.sourceContainerOnline ? 'online' : 'offline';
  }
}
