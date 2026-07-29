export type RuntimeConfigCheckLevel = 'required' | 'optional';

export interface RuntimeConfigCheck {
  key: string;
  level: RuntimeConfigCheckLevel;
  present: boolean;
  maskedValue?: string;
  message?: string;
}

export interface RuntimeAppConfig {
  nodeEnv: string;
  port: number;
}

export interface RuntimeDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  synchronize: boolean;
  timezone: string;
}

export interface RuntimeLokiConfig {
  transportEnabled: boolean;
  httpRequestPushEnabled: boolean;
  queryConfigured: boolean;
  host: string;
  queryHost: string;
  environment: string;
  tenantId: string;
  username: string;
  passwordConfigured: boolean;
}

export interface RuntimeMinioConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  bucket: string;
}

export interface RuntimeWordpressConfig {
  baseUrl: string;
  hostHeader: string;
  adminUsername: string;
  passwordConfigured: boolean;
  timeoutMs: number;
  loginTimeoutMs: number;
  availabilityTtlMs: number;
}

export interface RuntimeQqbotConfig {
  reverseWsPath: string;
  reverseWsToken: string;
  napcatRoot: string;
  napcatImage: string;
  napcatContainerMode: string;
  napcatSshTarget: string;
  napcatSshPort: number;
  napcatSshKeyPath: string;
  napcatReverseWsBase: string;
  napcatWebuiBaseUrl: string;
  napcatWebuiToken: string;
}

export interface RuntimeSecurityConfig {
  adminAuthAllowInsecureLocal: boolean;
  baselineLimit: number;
  live2dConcurrentLeaseMs: number;
  live2dConcurrentLimit: number;
  loginGlobalLimit: number;
  loginGlobalWindowMs: number;
  loginIpLimit: number;
  loginIpWindowMs: number;
  loginUsernameLimit: number;
  loginUsernameWindowMs: number;
  logoutSubjectLimit: number;
  logoutSubjectWindowMs: number;
  publicReadLimit: number;
  redisDb: number;
  redisHost: string;
  redisKeyPrefix: string;
  redisPort: number;
  refreshSubjectLimit: number;
  refreshSubjectWindowMs: number;
  swaggerAllowlistCount: number;
  trustedProxyCount: number;
  warningIntervalMs: number;
  windowMs: number;
}

export interface RuntimeSafeConfigSnapshot {
  app: RuntimeAppConfig;
  database: RuntimeDatabaseConfig;
  loki: RuntimeLokiConfig;
  minio: RuntimeMinioConfig;
  wordpress: RuntimeWordpressConfig;
  qqbot: RuntimeQqbotConfig;
  security: RuntimeSecurityConfig;
  checks: RuntimeConfigCheck[];
}
