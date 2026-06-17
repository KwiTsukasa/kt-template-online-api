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

const OPTIONAL_CONFIG_CHECKS: ReadonlyArray<string | readonly string[]> = [
  'MINIO_ENDPOINT',
  'MINIO_PORT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET',
  ['LOKI_HOST', 'LOKI_URL'],
  ['LOKI_QUERY_HOST', 'LOKI_HOST', 'LOKI_URL'],
  'LOKI_ENV',
  'LOKI_HTTP_REQUEST_PUSH_ENABLED',
  'LOKI_TENANT_ID',
  'LOKI_USERNAME',
  'LOKI_PASSWORD',
  'LOKI_PUSH_ENDPOINT',
  'LOKI_QUERY_ENDPOINT',
  'LOKI_PUSH_TIMEOUT_MS',
  'LOKI_QUERY_TIMEOUT_MS',
  'LOKI_BATCH_INTERVAL_SECONDS',
  'LOKI_BATCH_MAX_BUFFER_SIZE',
  'WORDPRESS_BASE_URL',
  'WORDPRESS_HOST_HEADER',
  'WORDPRESS_ADMIN_USERNAME',
  'WORDPRESS_ADMIN_PASSWORD',
  'WORDPRESS_TIMEOUT_MS',
  'WORDPRESS_LOGIN_TIMEOUT_MS',
  'WORDPRESS_AVAILABILITY_TTL_MS',
  'QQBOT_REVERSE_WS_PATH',
  'QQBOT_REVERSE_WS_TOKEN',
  'QQBOT_NAPCAT_ROOT',
  'QQBOT_NAPCAT_IMAGE',
  'QQBOT_NAPCAT_CONTAINER_MODE',
  'QQBOT_NAPCAT_SSH_TARGET',
  'QQBOT_NAPCAT_SSH_PORT',
  'QQBOT_NAPCAT_SSH_KEY_PATH',
  ['QQBOT_NAPCAT_REVERSE_WS_URL', 'QQBOT_NAPCAT_REVERSE_WS_BASE'],
  ['NAPCAT_WEBUI_BASE_URL', 'QQBOT_NAPCAT_WEBUI_URL'],
  ['NAPCAT_WEBUI_TOKEN', 'QQBOT_NAPCAT_WEBUI_TOKEN'],
];

@Injectable()
export class RuntimeConfigService {
  /**
   * 初始化 RuntimeConfigService 实例。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 读取 运行态健康检查资源。
   * @returns 运行态健康检查产出的 RuntimeAppConfig。
   */
  readAppProfile(): RuntimeAppConfig {
    return {
      nodeEnv: this.getString('NODE_ENV', 'development'),
      port: 48085,
    };
  }

  /**
   * 读取 运行态健康检查资源。
   * @returns 运行态健康检查产出的 RuntimeDatabaseConfig。
   */
  readDatabaseProfile(): RuntimeDatabaseConfig {
    return {
      host: this.getString('DB_HOST'),
      port: this.getPositiveNumber('DB_PORT', 3306),
      database: this.getString('DB_DATABASE'),
      username: this.getString('DB_USERNAME'),
      synchronize: this.getBoolean('DB_SYNC', false),
    };
  }

  /**
   * 读取 运行态健康检查资源。
   * @returns 运行态健康检查产出的 RuntimeLokiConfig。
   */
  readLokiProfile(): RuntimeLokiConfig {
    const host = this.getFirstString(['LOKI_HOST', 'LOKI_URL']);
    const queryHost = this.getFirstString([
      'LOKI_QUERY_HOST',
      'LOKI_HOST',
      'LOKI_URL',
    ]);

    return {
      transportEnabled: !!host,
      httpRequestPushEnabled:
        !!host && this.getBoolean('LOKI_HTTP_REQUEST_PUSH_ENABLED', true),
      queryConfigured: !!queryHost,
      host,
      queryHost,
      environment: this.getString(
        'LOKI_ENV',
        this.getString('NODE_ENV', 'development'),
      ),
      tenantId: this.getString('LOKI_TENANT_ID'),
      username: this.getString('LOKI_USERNAME'),
      passwordConfigured: !!this.getString('LOKI_PASSWORD'),
    };
  }

  /**
   * 读取 运行态健康检查资源。
   * @returns 运行态健康检查产出的 RuntimeMinioConfig。
   */
  readMinioProfile(): RuntimeMinioConfig {
    return {
      endpoint: this.getString('MINIO_ENDPOINT'),
      port: this.getPositiveNumber('MINIO_PORT', 9000),
      useSSL: false,
      accessKey: this.maskSecret(this.configService.get('MINIO_ACCESS_KEY')),
      bucket: this.getString('MINIO_BUCKET', 'kt-template-online'),
    };
  }

  /**
   * 读取 运行态健康检查资源。
   * @returns 运行态健康检查产出的 RuntimeWordpressConfig。
   */
  readWordpressProfile(): RuntimeWordpressConfig {
    const timeoutMs = this.getPositiveNumber('WORDPRESS_TIMEOUT_MS', 15000);

    return {
      baseUrl: this.getString('WORDPRESS_BASE_URL'),
      hostHeader: this.getString('WORDPRESS_HOST_HEADER'),
      adminUsername: this.getString('WORDPRESS_ADMIN_USERNAME'),
      passwordConfigured: !!this.getString('WORDPRESS_ADMIN_PASSWORD'),
      timeoutMs,
      loginTimeoutMs: this.getPositiveNumber(
        'WORDPRESS_LOGIN_TIMEOUT_MS',
        this.getPositiveNumber('WORDPRESS_TIMEOUT_MS', 3000),
      ),
      availabilityTtlMs: this.getPositiveNumber(
        'WORDPRESS_AVAILABILITY_TTL_MS',
        60_000,
      ),
    };
  }

  /**
   * 读取 运行态健康检查资源。
   * @returns 运行态健康检查产出的 RuntimeQqbotConfig。
   */
  readQqbotProfile(): RuntimeQqbotConfig {
    return {
      reverseWsPath: this.getString(
        'QQBOT_REVERSE_WS_PATH',
        '/qqbot/onebot/reverse',
      ),
      reverseWsToken: this.maskSecret(
        this.configService.get('QQBOT_REVERSE_WS_TOKEN'),
      ),
      napcatRoot: this.getString(
        'QQBOT_NAPCAT_ROOT',
        '/vol1/docker/kt-qqbot/napcat-instances',
      ),
      napcatImage: this.getString('QQBOT_NAPCAT_IMAGE'),
      napcatContainerMode: this.getString('QQBOT_NAPCAT_CONTAINER_MODE'),
      napcatSshTarget: this.getString('QQBOT_NAPCAT_SSH_TARGET', 'nas'),
      napcatSshPort: this.getPositiveNumber('QQBOT_NAPCAT_SSH_PORT', 22),
      napcatSshKeyPath: this.getString('QQBOT_NAPCAT_SSH_KEY_PATH'),
      napcatReverseWsBase: this.getFirstString([
        'QQBOT_NAPCAT_REVERSE_WS_URL',
        'QQBOT_NAPCAT_REVERSE_WS_BASE',
      ]),
      napcatWebuiBaseUrl: this.getFirstString([
        'NAPCAT_WEBUI_BASE_URL',
        'QQBOT_NAPCAT_WEBUI_URL',
      ]),
      napcatWebuiToken: this.maskSecret(
        this.getFirstString(['NAPCAT_WEBUI_TOKEN', 'QQBOT_NAPCAT_WEBUI_TOKEN']),
      ),
    };
  }

  /**
   * 查询 运行态健康检查数据。
   * @returns 运行态健康检查查询结果。
   */
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

  /**
   * 查询 运行态健康检查数据。
   * @returns 运行态健康检查查询结果。
   */
  getConfigChecks(): RuntimeConfigCheck[] {
    return [
      ...REQUIRED_CONFIG_KEYS.map((key) => this.createCheck(key, 'required')),
      ...OPTIONAL_CONFIG_CHECKS.map((check) =>
        typeof check === 'string'
          ? this.createCheck(check, 'optional')
          : this.createAnyCheck([...check], 'optional'),
      ),
    ];
  }

  /**
   * 执行 运行态健康检查流程。
   * @param value - 待转换值；驱动 `toolsService.toSecretText()` 的 运行态步骤。
   * @returns 运行态健康检查渲染后的图片、画布或文本。
   */
  maskSecret(value: unknown): string {
    const text = this.toolsService.toSecretText(value);
    if (!text) return '';
    if (text.length <= 4) return '****';
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  }

  /**
   * 创建 运行态健康检查对象或配置。
   * @param key - 键名；驱动 `configService.get()` 的 运行态步骤。
   * @param level - level 输入；生成 运行态对象。
   * @returns 创建后的 运行态健康检查对象或配置。
   */
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

  /**
   * 创建 运行态健康检查对象或配置。
   * @param keys - 运行态列表；生成规范化文本。
   * @param level - level 输入；生成 运行态对象。
   * @returns 创建后的 运行态健康检查对象或配置。
   */
  private createAnyCheck(
    keys: string[],
    level: RuntimeConfigCheckLevel,
  ): RuntimeConfigCheck {
    const key = keys.join('|');
    const value = this.getFirstString(keys);
    const present = !!value;

    return {
      key,
      level,
      present,
      maskedValue: present ? this.maskSecret(value) : undefined,
      message: present ? undefined : `${key} is not configured`,
    };
  }

  /**
   * 查询 运行态健康检查数据。
   * @param key - 键名；驱动 `toolsService.toTrimmedString()` 的 运行态步骤。
   * @param fallback - 兜底值；限定 运行态查询范围。
   */
  private getString(key: string, fallback = '') {
    const value = this.toolsService.toTrimmedString(
      this.configService.get(key),
    );
    return value || fallback;
  }

  /**
   * 查询 运行态健康检查数据。
   * @param keys - 运行态列表；驱动 `for()` 的 运行态步骤。
   * @param fallback - 兜底值；限定 运行态查询范围。
   */
  private getFirstString(keys: string[], fallback = '') {
    for (const key of keys) {
      const value = this.getString(key);
      if (value) return value;
    }
    return fallback;
  }

  /**
   * 查询 运行态健康检查数据。
   * @param key - 键名；驱动 `toolsService.toPositiveNumber()` 的 运行态步骤。
   * @param fallback - 兜底值；驱动 `toolsService.toPositiveNumber()` 的 运行态步骤。
   */
  private getPositiveNumber(key: string, fallback: number) {
    return this.toolsService.toPositiveNumber(
      this.configService.get<string | number>(key),
      fallback,
    );
  }

  /**
   * 查询 运行态健康检查数据。
   * @param key - 键名；驱动 `toolsService.normalizeBoolean()` 的 运行态步骤。
   * @param fallback - 兜底值；驱动 `toolsService.normalizeBoolean()` 的 运行态步骤。
   */
  private getBoolean(key: string, fallback: boolean) {
    return this.toolsService.normalizeBoolean(
      this.configService.get<string | boolean | number>(key),
      fallback,
    );
  }
}
