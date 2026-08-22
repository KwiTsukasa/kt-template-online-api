import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import type {
  NapcatRuntime,
  NapcatWebuiStatus,
} from '@/modules/bot-adapter/core/contract/bot.types';
import { NapcatContainerService } from '../../infrastructure/integration/container/napcat-container.service';
import { NapcatWebuiGatewayAudit } from '../infrastructure/persistence/napcat-webui-gateway-audit.entity';
import {
  NapcatWebuiGatewayClient,
  type NapcatWebuiGatewayLifecycleResult,
} from '../infrastructure/napcat-webui-gateway.client';
import type { NapcatWebuiSessionResponseDto } from '../contract/napcat-webui-gateway.dto';

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

export type NapcatWebuiGatewaySessionCreateInput = {
  accountId: string;
  adminUserId: string;
  clientIp?: string | null;
  userAgent?: string | null;
};

export type NapcatWebuiGatewaySessionLifecycleInput = {
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

  /**
   * 根据`input`处理记录NapCatWebUI审计记录；把变更持久化到当前存储（`auditRepository.create`）。
   * @param input - 用于记录NapCatWebUI审计记录的结构化输入，包含 `accountId`、`adminUserId`、`clientIp`、`containerId` 字段。
   * @returns 记录NapCatWebUI审计记录。
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
   * 将`detail`规范为详情，使等价输入得到一致表示。
   * @param detail - 决定详情内容、边界或目标的 `detail` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 详情；无法解析或未命中时为 `null`。
   */
  private sanitizeDetail(detail?: null | Record<string, unknown>) {
    if (!detail) return null;
    return this.sanitizeValue(detail) as Record<string, unknown>;
  }

  /**
   * 将`value`规范为值，使等价输入得到一致表示；当 `Array.isArray(value)` 成立时返回 `value.map((item) => this.sanitizeValue(item…`。
   * @param value - 参与值比较、格式化或输出的候选值。
   * @returns 值。
   */
  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (typeof value === 'string') {
      if (this.isUnsafeDetailString(value)) {
        return REDACTED_DETAIL_VALUE;
      }
      return value;
    }
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !this.isSensitiveDetailKey(key))
        .map(([key, item]) => [key, this.sanitizeValue(item)]),
    );
  }

  /**
   * 根据`key`与当前约束判定敏感的详情键。
   * @param key - 用于读取或更新敏感的详情键的稳定键。
   * @returns 满足敏感的详情键约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据`value`与当前约束判定不安全的详情字符串。
   * @param value - 待判定是否满足不安全的详情字符串约束的候选值。
   * @returns 满足不安全的详情字符串约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isUnsafeDetailString(value: string) {
    return UNSAFE_DETAIL_STRING_PATTERN.test(value);
  }

  /**
   * 将输入收敛并投影为可空的文本。
   * @param value - 待转换为可空的文本的原始值。
   * @param limit - 允许返回或处理的可空的文本最大数量。
   * @returns 可空的文本；无法解析或未命中时为 `null`。
   */
  private toNullableText(value: null | string | undefined, limit: number) {
    const text = String(value || '').trim();
    if (text) {
      return text.slice(0, limit);
    }
    return null;
  }
}

@Injectable()
export class NapcatWebuiGatewayService {
  constructor(
    private readonly accountService: BotAccountService,
    private readonly containerService: NapcatContainerService,
    private readonly gatewayClient: NapcatWebuiGatewayClient,
    private readonly auditService: NapcatWebuiGatewayAuditService,
  ) {}

  /**
   * 根据`input`构造NapCat WebUI 网关会话；先通过 `requireAccountId` 校验输入边界。
   * @param input - 用于NapCat WebUI 网关会话的结构化输入，包含 `accountId`、`adminUserId`、`clientIp`、`userAgent` 字段。
   * @returns 包含 `account`、`container`、`expiresAt`、`iframeUrl`、`sessionId` 字段的NapCat WebUI 网关会话。
   */
  async createSession(
    input: NapcatWebuiGatewaySessionCreateInput,
  ): Promise<NapcatWebuiSessionResponseDto> {
    const accountId = this.requireAccountId(input.accountId);
    const account = await this.accountService.findById(accountId);
    if (!account) {
      throwVbenError('Bot 账号不存在');
    }
    if ((account.connectionMode || 'reverse-ws') !== 'reverse-ws') {
      throwVbenError('QQ 官方 Bot 不提供 NapCat WebUI');
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

  /**
   * 使用会话标识提交心跳续期请求，并返回续期后的会话状态。
   * @param input - 包含 `adminUserId`、`clientIp`、`sessionId`、`userAgent` 字段的结构化领域输入。
   * @returns 返回续期后的网关会话状态或对应的成功响应。
   */
  heartbeat(
    input: NapcatWebuiGatewaySessionLifecycleInput,
  ): Promise<NapcatWebuiGatewayLifecycleResult> {
    return this.gatewayClient.heartbeat({
      adminUserId: input.adminUserId,
      clientIp: input.clientIp || undefined,
      sessionId: this.requireSessionId(input.sessionId),
      userAgent: input.userAgent || undefined,
    });
  }

  /**
   * 按`input`移除BotNapCatWebUI记录；先通过 `requireSessionId` 校验输入边界。
   * @param input - 用于BotNapCatWebUI记录的结构化输入，包含 `adminUserId`、`clientIp`、`sessionId`、`userAgent` 字段。
   * @returns BotNapCatWebUI记录。
   */
  revoke(
    input: NapcatWebuiGatewaySessionLifecycleInput,
  ): Promise<NapcatWebuiGatewayLifecycleResult> {
    return this.gatewayClient.revoke({
      adminUserId: input.adminUserId,
      clientIp: input.clientIp || undefined,
      sessionId: this.requireSessionId(input.sessionId),
      userAgent: input.userAgent || undefined,
    });
  }

  /**
   * 校验`accountId`是否满足前置条件并返回必需账号标识约束，并拒绝不合法输入。
   * @param accountId - 用于精确定位账号的标识。
   * @returns 前置条件并返回必需账号标识。
   */
  private requireAccountId(accountId: string) {
    const normalized = String(accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(normalized)) {
      throwVbenError('Bot 账号ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * 校验`sessionId`是否满足前置条件并返回必需会话标识约束，并拒绝不合法输入。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 前置条件并返回必需会话标识。
   */
  private requireSessionId(sessionId: string) {
    const normalized = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(normalized)) {
      throwVbenError('Gateway 会话ID不合法', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * 将输入收敛并投影为网关目标。
   * @param runtime - 用于网关目标的领域对象，包含 `baseUrl`、`webuiToken`、`webuiPort` 字段。
   * @returns 包含 `upstreamBaseUrl`、`webuiToken` 字段的网关目标。
   */
  private toGatewayTarget(runtime: NapcatRuntime) {
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
   * 将输入收敛并投影为WebUI状态。
   * @param runtime - 用于WebUI状态的领域对象，包含 `sourceContainerOnline` 字段。
   * @returns 当前状态对应的WebUI状态，取值为 `'online'`、`'offline'`。
   */
  private toWebuiStatus(runtime: NapcatRuntime): NapcatWebuiStatus {
    if (runtime.sourceContainerOnline) {
      return 'online';
    }
    return 'offline';
  }
}
