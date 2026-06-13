import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolsService } from '../../common';
import {
  RuntimeAppConfig,
  RuntimeConfigCheck,
  RuntimeConfigCheckLevel,
  RuntimeDatabaseConfig,
  RuntimeLokiConfig,
  RuntimeMinioConfig,
  RuntimeQqbotConfig,
  RuntimeSafeConfigSnapshot,
  RuntimeWordpressConfig,
} from './runtime-config.types';

const REQUIRED_CONFIG_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'ADMIN_TOKEN_SECRET',
] as const;

const OPTIONAL_CONFIG_KEYS = [
  'MINIO_ENDPOINT',
  'MINIO_PORT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'LOKI_HOST',
  'WORDPRESS_API_URL',
  'QQBOT_REVERSE_WS_URL',
  'NAPCAT_DATA_ROOT',
  'NAPCAT_SSH_HOST',
  'NAPCAT_SSH_PORT',
  'NAPCAT_SSH_USER',
] as const;

@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  readAppProfile(): RuntimeAppConfig {
    return {
      nodeEnv: this.getString('NODE_ENV', 'development'),
      port: this.getPositiveNumber('PORT', 48085),
    };
  }

  readDatabaseProfile(): RuntimeDatabaseConfig {
    return {
      host: this.getString('DB_HOST'),
      port: this.getPositiveNumber('DB_PORT', 3306),
      database: this.getString('DB_DATABASE'),
      username: this.getString('DB_USERNAME'),
      synchronize: this.getBoolean('DB_SYNC', false),
    };
  }

  readLokiProfile(): RuntimeLokiConfig {
    return {
      enabled: this.getBoolean('LOKI_ENABLED', false),
      host: this.getString('LOKI_HOST'),
      basicAuth: this.maskSecret(this.configService.get('LOKI_BASIC_AUTH')),
    };
  }

  readMinioProfile(): RuntimeMinioConfig {
    return {
      endpoint: this.getString('MINIO_ENDPOINT'),
      port: this.getPositiveNumber('MINIO_PORT', 9000),
      useSSL: this.getBoolean('MINIO_USE_SSL', false),
      accessKey: this.maskSecret(this.configService.get('MINIO_ACCESS_KEY')),
    };
  }

  readWordpressProfile(): RuntimeWordpressConfig {
    return {
      endpoint: this.getString('WORDPRESS_API_URL'),
      username: this.maskSecret(this.configService.get('WORDPRESS_USERNAME')),
    };
  }

  readQqbotProfile(): RuntimeQqbotConfig {
    return {
      reverseWsUrl: this.getString('QQBOT_REVERSE_WS_URL'),
      napcatDataRoot: this.getString('NAPCAT_DATA_ROOT'),
      napcatSshHost: this.getString('NAPCAT_SSH_HOST'),
      napcatSshPort: this.getPositiveNumber('NAPCAT_SSH_PORT', 22),
      napcatSshUser: this.getString('NAPCAT_SSH_USER'),
    };
  }

  getSafeSnapshot(): RuntimeSafeConfigSnapshot {
    return {
      app: this.readAppProfile(),
      database: this.readDatabaseProfile(),
      loki: this.readLokiProfile(),
      minio: this.readMinioProfile(),
      wordpress: this.readWordpressProfile(),
      qqbot: this.readQqbotProfile(),
      checks: this.getConfigChecks(),
    };
  }

  getConfigChecks(): RuntimeConfigCheck[] {
    return [
      ...REQUIRED_CONFIG_KEYS.map((key) => this.createCheck(key, 'required')),
      ...OPTIONAL_CONFIG_KEYS.map((key) => this.createCheck(key, 'optional')),
    ];
  }

  maskSecret(value: unknown): string {
    const text = this.toolsService.toSecretText(value);
    if (!text) return '';
    if (text.length <= 4) return '****';
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  }

  private createCheck(
    key: string,
    level: RuntimeConfigCheckLevel,
  ): RuntimeConfigCheck {
    const value = this.configService.get(key);
    const text = this.toolsService.toSecretText(value);
    const present = !!text;

    return {
      key,
      level,
      present,
      maskedValue: present ? this.maskSecret(value) : undefined,
      message: present ? undefined : `${key} is not configured`,
    };
  }

  private getString(key: string, fallback = '') {
    const value = this.toolsService.toTrimmedString(this.configService.get(key));
    return value || fallback;
  }

  private getPositiveNumber(key: string, fallback: number) {
    return this.toolsService.toPositiveNumber(
      this.configService.get<string | number>(key),
      fallback,
    );
  }

  private getBoolean(key: string, fallback: boolean) {
    return this.toolsService.normalizeBoolean(
      this.configService.get<string | boolean | number>(key),
      fallback,
    );
  }
}
