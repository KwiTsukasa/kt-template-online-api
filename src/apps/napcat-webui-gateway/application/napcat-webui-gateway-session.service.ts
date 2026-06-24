import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
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
    const existing = await this.store.findActiveByUserAndAccount(
      input.adminUserId,
      input.accountId,
    );
    if (existing) {
      await this.store.update(existing.sessionId, {
        revokedAt: this.config.now(),
        status: 'revoked',
      });
    }

    const now = this.config.now();
    const session: NapcatWebuiGatewaySession = {
      accountId: input.accountId,
      adminUserId: input.adminUserId,
      clientIp: this.toOptionalText(input.clientIp),
      containerId: input.containerId,
      containerName: input.containerName,
      createdAt: now,
      expiresAt: now + this.config.ttlMs(),
      selfId: input.selfId,
      sessionId: randomUUID(),
      status: 'created',
      upstreamBaseUrl: input.upstreamBaseUrl,
      userAgent: this.toOptionalText(input.userAgent),
      webuiToken: input.webuiToken,
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

    return this.store.update(sessionId, {
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
    const session = await this.requireUsableSession(input.sessionId);
    this.assertOwner(session, input.adminUserId);
    const now = this.config.now();
    const expiresAt = now + this.config.ttlMs();

    await this.store.update(input.sessionId, {
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
    const session = await this.store.find(input.sessionId);
    if (!session) throw new Error('Gateway session is not active');
    this.assertOwner(session, input.adminUserId);

    const updated = await this.store.update(input.sessionId, {
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
      throw new Error('Gateway session is not active');
    }
    if (session.expiresAt <= this.config.now()) {
      await this.store.update(sessionId, { status: 'expired' });
      throw new Error('Gateway session is not active');
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
      throw new Error('Gateway session owner mismatch');
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
