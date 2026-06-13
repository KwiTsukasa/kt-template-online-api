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
}

export interface RuntimeLokiConfig {
  enabled: boolean;
  host: string;
  basicAuth: string;
}

export interface RuntimeMinioConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
}

export interface RuntimeWordpressConfig {
  endpoint: string;
  username: string;
}

export interface RuntimeQqbotConfig {
  reverseWsUrl: string;
  napcatDataRoot: string;
  napcatSshHost: string;
  napcatSshPort: number;
  napcatSshUser: string;
}

export interface RuntimeSafeConfigSnapshot {
  app: RuntimeAppConfig;
  database: RuntimeDatabaseConfig;
  loki: RuntimeLokiConfig;
  minio: RuntimeMinioConfig;
  wordpress: RuntimeWordpressConfig;
  qqbot: RuntimeQqbotConfig;
  checks: RuntimeConfigCheck[];
}
