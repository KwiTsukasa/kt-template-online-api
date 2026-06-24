export type NapcatWebuiGatewaySessionStatus =
  | 'active'
  | 'created'
  | 'expired'
  | 'failed'
  | 'revoked';

export interface NapcatWebuiGatewaySession {
  accountId: string;
  activeAt?: number;
  adminUserId: string;
  clientIp?: string;
  containerId: string;
  containerName: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
  selfId: string;
  sessionId: string;
  status: NapcatWebuiGatewaySessionStatus;
  upstreamBaseUrl: string;
  userAgent?: string;
  webuiToken: string;
}

export interface NapcatWebuiGatewaySessionStore {
  create(
    session: NapcatWebuiGatewaySession,
  ): Promise<NapcatWebuiGatewaySession>;
  find(sessionId: string): Promise<NapcatWebuiGatewaySession | undefined>;
  findActiveByUserAndAccount(
    adminUserId: string,
    accountId: string,
  ): Promise<NapcatWebuiGatewaySession | undefined>;
  update(
    sessionId: string,
    patch: Partial<NapcatWebuiGatewaySession>,
  ): Promise<NapcatWebuiGatewaySession>;
}

export type NapcatWebuiGatewayCreateSessionInput = {
  accountId: string;
  adminUserId: string;
  clientIp?: string;
  containerId: string;
  containerName: string;
  selfId: string;
  upstreamBaseUrl: string;
  userAgent?: string;
  webuiToken: string;
};

export type NapcatWebuiGatewayLifecycleInput = {
  adminUserId: string;
  clientIp?: string;
  sessionId: string;
  userAgent?: string;
};

export const NAPCAT_WEBUI_GATEWAY_SESSION_STORE =
  'NAPCAT_WEBUI_GATEWAY_SESSION_STORE';
