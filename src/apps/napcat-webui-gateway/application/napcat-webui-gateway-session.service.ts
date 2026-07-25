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

  async requireBootstrapSession(sessionId: string) {
    return this.requireUsableSession(sessionId);
  }

  async requireProxySession(sessionId: string) {
    const session = await this.requireUsableSession(sessionId);
    if (session.status !== 'active') {
      throw new GoneException('Gateway session is not active');
    }

    return session;
  }

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

  private assertOwner(
    session: NapcatWebuiGatewaySession,
    adminUserId: string,
  ) {
    if (session.adminUserId !== adminUserId) {
      throw new ForbiddenException('Gateway session owner mismatch');
    }
  }

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

  private isInactiveStoreError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Gateway session is not active') ||
      message.includes('Gateway terminal session cannot become active')
    );
  }

  private requireLifecycleAdminUserId(adminUserId: string) {
    return this.requireText(adminUserId, 'adminUserId');
  }

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

  private requireText(value: string, fieldName: string) {
    const text = this.toOptionalText(value);
    if (!text) {
      throw new BadRequestException(
        `Gateway session field ${fieldName} is required`,
      );
    }

    return text;
  }

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

  private toOptionalText(value?: string) {
    const text = String(value || '').trim();
    return text || undefined;
  }
}
