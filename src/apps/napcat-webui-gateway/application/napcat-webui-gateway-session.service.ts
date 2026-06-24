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
  /**
   * Creates the Gateway session lifecycle service.
   * @param store - Session store abstraction backed by Redis in production.
   * @param config - Gateway runtime config and time source.
   */
  constructor(
    @Inject(NAPCAT_WEBUI_GATEWAY_SESSION_STORE)
    private readonly store: NapcatWebuiGatewaySessionStore,
    private readonly config: NapcatWebuiGatewayConfigService,
  ) {}

  /**
   * Creates a new Gateway session and revokes an older same-user same-account session.
   * @param input - Internal API payload with server-only WebUI target metadata.
   * @returns Created session persisted in the store.
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
   * Marks a bootstrap-created session active before proxy traffic is allowed.
   * @param sessionId - Gateway session id being bootstrapped.
   * @returns Updated active session.
   */
  async markActive(sessionId: string) {
    const session = await this.requireUsableSession(sessionId);
    const now = this.config.now();

    return this.updateSession(sessionId, {
      activeAt: session.activeAt || now,
      expiresAt: now + this.config.ttlMs(),
      lastSeenAt: now,
      status: 'active',
    });
  }

  /**
   * Extends an Admin-owned active Gateway session.
   * @param input - Session id plus Admin ownership and request evidence.
   * @returns Browser-safe lifecycle result.
   */
  async heartbeat(input: NapcatWebuiGatewayLifecycleInput) {
    const adminUserId = this.requireLifecycleAdminUserId(input.adminUserId);
    const session = await this.requireUsableSession(input.sessionId);
    this.assertOwner(session, adminUserId);
    const now = this.config.now();
    const expiresAt = now + this.config.ttlMs();

    await this.updateSession(input.sessionId, {
      clientIp: this.toOptionalText(input.clientIp) || session.clientIp,
      expiresAt,
      lastSeenAt: now,
      status: 'active',
      userAgent: this.toOptionalText(input.userAgent) || session.userAgent,
    });

    return {
      expiresAt,
      sessionId: input.sessionId,
      status: 'active' as const,
    };
  }

  /**
   * Revokes an Admin-owned Gateway session.
   * @param input - Session id plus Admin ownership and request evidence.
   * @returns Browser-safe lifecycle result.
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
   * Loads a session only when it is usable for later proxy handling.
   * @param sessionId - Gateway session id from a public Gateway route.
   * @returns Stored server-only session metadata for proxy setup.
   */
  async requireProxySession(sessionId: string) {
    return this.requireUsableSession(sessionId);
  }

  /**
   * Loads and validates a non-terminal, non-expired session.
   * @param sessionId - Gateway session id.
   * @returns Usable Gateway session.
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

    return session;
  }

  /**
   * Ensures lifecycle calls can only mutate sessions owned by the same Admin user.
   * @param session - Stored Gateway session.
   * @param adminUserId - Admin actor id from the internal API payload.
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
   * Applies a store update and maps expected stale lifecycle rejections to 410.
   * @param sessionId - Gateway session id to update.
   * @param patch - Session fields to merge in the store.
   * @returns Updated session from the backing store.
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
   * Detects stale or inactive store errors that should not become HTTP 500.
   * @param error - Error thrown by the session store.
   * @returns Whether the error represents an expected inactive session race.
   */
  private isInactiveStoreError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Gateway session is not active') ||
      message.includes('Gateway terminal session cannot become active')
    );
  }

  /**
   * Requires a lifecycle Admin actor before owner comparison.
   * @param adminUserId - Candidate Admin actor id from heartbeat or revoke body.
   * @returns Trimmed Admin actor id.
   */
  private requireLifecycleAdminUserId(adminUserId: string) {
    return this.requireText(adminUserId, 'adminUserId');
  }

  /**
   * Validates and normalizes the internal create-session payload before persistence.
   * @param input - Internal API payload supplied by the main API process.
   * @returns Normalized create payload with required fields trimmed.
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
   * Requires a non-empty text field from the internal create-session payload.
   * @param value - Candidate field value.
   * @param fieldName - Payload field name used in the error message.
   * @returns Trimmed field text.
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
   * Validates the upstream WebUI base URL without restricting Docker host shape.
   * @param value - Candidate upstream URL.
   * @returns Trimmed http or https URL.
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
   * Normalizes optional evidence fields before storing them.
   * @param value - Optional string value.
   * @returns Trimmed text or undefined.
   */
  private toOptionalText(value?: string) {
    const text = String(value || '').trim();
    return text || undefined;
  }
}
