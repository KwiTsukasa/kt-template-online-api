import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { NapcatWebuiGatewayConfigService } from '../config/napcat-webui-gateway-config.service';
import {
  NAPCAT_WEBUI_GATEWAY_SESSION_STORE,
  type NapcatWebuiGatewayCreateSessionInput,
  type NapcatWebuiGatewayLifecycleInput,
  type NapcatWebuiGatewaySession,
  type NapcatWebuiGatewaySessionStore,
} from '../domain/napcat-webui-gateway.types';

const TERMINAL_SESSION_STATUSES = ['expired', 'failed', 'revoked'];

@Injectable()
export class NapcatWebuiGatewaySessionService {
  constructor(
    @Inject(NAPCAT_WEBUI_GATEWAY_SESSION_STORE)
    private readonly store: NapcatWebuiGatewaySessionStore,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  /**
   * 根据`input`构造NapCatWebUI会话记录；把变更持久化到当前存储（`store.create`）。
   * @param input - 用于NapCatWebUI会话记录的结构化输入。
   * @returns NapCatWebUI会话记录。
   */
  async create(input: NapcatWebuiGatewayCreateSessionInput) {
    const normalizedInput = this.validateCreateInput(input);
    const existing = await this.store.findActiveByUserAndAccount(
      normalizedInput.adminUserId,
      normalizedInput.accountId,
    );
    if (existing) {
      await this.updateSession(existing.sessionId, {
        revokedAt: this.config.now(),
        status: 'revoked',
      });
    }

    const now = this.config.now();
    const session: NapcatWebuiGatewaySession = {
      accountId: normalizedInput.accountId,
      adminUserId: normalizedInput.adminUserId,
      clientIp: this.toOptionalText(normalizedInput.clientIp),
      containerId: normalizedInput.containerId,
      containerName: normalizedInput.containerName,
      createdAt: now,
      expiresAt: now + this.config.ttlMs(),
      selfId: normalizedInput.selfId,
      sessionId: randomUUID(),
      status: 'created',
      upstreamBaseUrl: normalizedInput.upstreamBaseUrl,
      userAgent: this.toOptionalText(normalizedInput.userAgent),
      webuiToken: normalizedInput.webuiToken,
    };

    return this.store.create(session);
  }

  /**
   * 根据`sessionId`处理标记启用的；先通过 `requireBootstrapSession` 校验输入边界。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 标记启用的。
   */
  async markActive(sessionId: string) {
    const session = await this.requireBootstrapSession(sessionId);
    const now = this.config.now();

    return this.updateSession(sessionId, {
      activeAt: session.activeAt || now,
      expiresAt: now + this.config.ttlMs(),
      lastSeenAt: now,
      status: 'active',
    });
  }

  /**
   * 使用会话标识提交心跳续期请求，并返回续期后的会话状态。
   * @param input - 包含 `adminUserId`、`sessionId`、`clientIp`、`userAgent` 字段的结构化领域输入。
   * @returns 返回续期后的网关会话状态或对应的成功响应。
   */
  async heartbeat(input: NapcatWebuiGatewayLifecycleInput) {
    const adminUserId = this.requireLifecycleAdminUserId(input.adminUserId);
    const session = await this.requireProxySession(input.sessionId);
    this.assertOwner(session, adminUserId);
    const now = this.config.now();
    const expiresAt = now + this.config.ttlMs();

    const updated = await this.updateSession(input.sessionId, {
      clientIp: this.toOptionalText(input.clientIp) || session.clientIp,
      expiresAt,
      lastSeenAt: now,
      status: 'active',
      userAgent: this.toOptionalText(input.userAgent) || session.userAgent,
    });

    return {
      expiresAt: updated.expiresAt,
      sessionId: input.sessionId,
      status: 'active' as const,
    };
  }

  /**
   * 按`input`移除NapCatWebUI会话记录；先通过 `requireLifecycleAdminUserId` 校验输入边界。
   * @param input - 用于NapCatWebUI会话记录的结构化输入，包含 `adminUserId`、`sessionId`、`clientIp`、`userAgent` 字段。
   * @returns 包含 `expiresAt`、`sessionId`、`status` 字段的NapCatWebUI会话记录。
   */
  async revoke(input: NapcatWebuiGatewayLifecycleInput) {
    const adminUserId = this.requireLifecycleAdminUserId(input.adminUserId);
    const session = await this.requireUsableSession(input.sessionId);
    this.assertOwner(session, adminUserId);

    const updated = await this.updateSession(input.sessionId, {
      clientIp: this.toOptionalText(input.clientIp) || session.clientIp,
      revokedAt: this.config.now(),
      status: 'revoked',
      userAgent: this.toOptionalText(input.userAgent) || session.userAgent,
    });

    return {
      expiresAt: updated.expiresAt,
      sessionId: input.sessionId,
      status: 'revoked' as const,
    };
  }

  /**
   * 校验`sessionId`是否满足前置条件并返回必需引导流程会话约束，并拒绝不合法输入；先通过 `requireUsableSession` 校验输入边界。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 前置条件并返回必需引导流程会话。
   */
  async requireBootstrapSession(sessionId: string) {
    return this.requireUsableSession(sessionId);
  }

  /**
   * 取得仍然可用且已进入活动状态的网关会话，供后续代理请求使用。
   * @param sessionId - 要进入代理阶段的服务端会话标识。
   * @returns 已通过活动状态检查的网关会话。
   * @throws 会话尚未进入活动状态时抛出 `GoneException`。
   */
  async requireProxySession(sessionId: string) {
    const session = await this.requireUsableSession(sessionId);
    if (session.status !== 'active') {
      throw new GoneException('Gateway session is not active');
    }

    return session;
  }

  /**
   * 读取未终止、未过期且仍是账号当前活动索引的网关会话；过期会话会先落库为过期状态。
   * @param sessionId - 要验证可用性的服务端会话标识。
   * @returns 同时通过生命周期和账号活动索引检查的会话。
   * @throws 会话不存在、已终止、已过期或不再匹配账号活动索引时抛出 `GoneException`。
   */
  private async requireUsableSession(sessionId: string) {
    const session = await this.store.find(sessionId);
    if (!session || TERMINAL_SESSION_STATUSES.includes(session.status)) {
      throw new GoneException('Gateway session is not active');
    }
    if (session.expiresAt <= this.config.now()) {
      await this.updateSession(sessionId, { status: 'expired' });
      throw new GoneException('Gateway session is not active');
    }

    const indexed = await this.store.findActiveByUserAndAccount(
      session.adminUserId,
      session.accountId,
    );
    if (!indexed || indexed.sessionId !== session.sessionId) {
      throw new GoneException('Gateway session is not active');
    }

    return session;
  }

  /**
   * 校验`session`、`adminUserId`是否满足所有者约束，并拒绝不合法输入。
   * @param session - 待读取、续期或持久化的所有者会话。
   * @param adminUserId - 用于精确定位admin用户的标识。
   * @throws 当 `session.adminUserId !== adminUserId` 成立时拒绝当前输入并抛出 `ForbiddenException`。
   */
  private assertOwner(
    session: NapcatWebuiGatewaySession,
    adminUserId: string,
  ) {
    if (session.adminUserId !== adminUserId) {
      throw new ForbiddenException('Gateway session owner mismatch');
    }
  }

  /**
   * 持久化会话字段补丁，并把存储层的会话失活错误统一映射为 HTTP 过期语义。
   * @param sessionId - 要更新的服务端会话标识。
   * @param patch - 原子合并到现有会话的字段补丁。
   * @returns 存储层更新后的完整会话。
   * @throws 存储层报告会话已失活时抛出 `GoneException`；其他更新失败原样重新抛出。
   */
  private async updateSession(
    sessionId: string,
    patch: Partial<NapcatWebuiGatewaySession>,
  ) {
    try {
      return await this.store.update(sessionId, patch);
    } catch (error) {
      if (this.isInactiveStoreError(error)) {
        throw new GoneException('Gateway session is not active');
      }
      throw error;
    }
  }

  /**
   * 根据`error`与当前约束判定未激活的存储错误。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足未激活的存储错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isInactiveStoreError(error: unknown) {
    const message = (() => {
      if (error instanceof Error) {
        return error.message;
      }
      return String(error);
    })();
    return (
      message.includes('Gateway session is not active') ||
      message.includes('Gateway terminal session cannot become active')
    );
  }

  /**
   * 校验前置条件并返回必需生命周期管理端用户标识。
   * @param adminUserId - 用于精确定位admin用户的标识。
   * @returns 前置条件并返回必需生命周期管理端用户标识。
   */
  private requireLifecycleAdminUserId(adminUserId: string) {
    return this.requireText(adminUserId, 'adminUserId');
  }

  /**
   * 校验`input`是否满足创建输入约束，并拒绝不合法输入；先通过 `requireText` 校验输入边界。
   * @param input - 用于创建输入的结构化输入，包含 `accountId`、`adminUserId`、`containerId`、`containerName` 字段。
   * @returns 创建输入。
   */
  private validateCreateInput(input: NapcatWebuiGatewayCreateSessionInput) {
    const normalized = {
      ...input,
      accountId: this.requireText(input.accountId, 'accountId'),
      adminUserId: this.requireText(input.adminUserId, 'adminUserId'),
      containerId: this.requireText(input.containerId, 'containerId'),
      containerName: this.requireText(input.containerName, 'containerName'),
      selfId: this.requireText(input.selfId, 'selfId'),
      upstreamBaseUrl: this.requireUpstreamBaseUrl(input.upstreamBaseUrl),
      webuiToken: this.requireText(input.webuiToken, 'webuiToken'),
    };

    return normalized;
  }

  /**
   * 校验`value`、`fieldName`是否满足前置条件并返回必需文本约束，并拒绝不合法输入。
   * @param value - 参与前置条件并返回必需文本比较、格式化或输出的候选值。
   * @param fieldName - 决定前置条件并返回必需文本内容、边界或目标的 `fieldName` 值。
   * @returns 前置条件并返回必需文本。
   * @throws 当 `!text` 成立时拒绝当前输入并抛出 `BadRequestException`。
   */
  private requireText(value: string, fieldName: string) {
    const text = this.toOptionalText(value);
    if (!text) {
      throw new BadRequestException(
        `Gateway session field ${fieldName} is required`,
      );
    }

    return text;
  }

  /**
   * 校验`value`是否满足前置条件并返回必需上游BaseURL约束，并拒绝不合法输入；先通过 `requireText` 校验输入边界。
   * @param value - 参与前置条件并返回必需上游BaseURL比较、格式化或输出的候选值。
   * @returns 前置条件并返回必需上游BaseURL。
   * @throws 输入不是有效 HTTP/HTTPS URL，或 URL 构造与协议校验失败时抛出 `BadRequestException`。
   */
  private requireUpstreamBaseUrl(value: string) {
    const text = this.requireText(value, 'upstreamBaseUrl');
    try {
      const url = new URL(text);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Unsupported protocol');
      }
      return text;
    } catch {
      throw new BadRequestException('Gateway session upstream URL is invalid');
    }
  }

  /**
   * 将输入收敛并投影为可选的文本。
   * @param value - 待转换为可选的文本的原始值；为空时采用 `''` 作为兜底。
   * @returns 规范化后的可选的文本；主值为空时采用 `undefined` 兜底；没有可用结果或提前结束时为 `undefined`。
   */
  private toOptionalText(value?: string) {
    const text = String(value || '').trim();
    return text || undefined;
  }
}
