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
  RuntimeSecurityConfig,
} from './runtime-config.types';

const REQUIRED_CONFIG_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'ADMIN_TOKEN_SECRET',
  'NETWORK_AGENT_ID',
  'NETWORK_AGENT_TARGET_IPV4',
  'NETWORK_AGENT_MQTT_URL',
  'NETWORK_AGENT_MQTT_CLIENT_ID',
  'NETWORK_AGENT_MQTT_USERNAME',
  'NETWORK_AGENT_MQTT_PASSWORD',
  'NETWORK_AGENT_MQTT_RETRY_MS',
  'PUBLIC_SECURITY_TRUSTED_PROXY_IPS',
  'PUBLIC_SECURITY_SWAGGER_ALLOWLIST',
  'PUBLIC_RATE_LIMIT_REDIS_HOST',
  'PUBLIC_RATE_LIMIT_REDIS_PORT',
  'PUBLIC_RATE_LIMIT_REDIS_DB',
  'PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX',
  'PUBLIC_RATE_LIMIT_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_PUBLIC_READ_LIMIT',
  'PUBLIC_RATE_LIMIT_BASELINE_LIMIT',
  'PUBLIC_RATE_LIMIT_WARNING_INTERVAL_MS',
  'PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT',
  'PUBLIC_RATE_LIMIT_LOGIN_IP_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_LOGIN_USERNAME_LIMIT',
  'PUBLIC_RATE_LIMIT_LOGIN_USERNAME_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_LIMIT',
  'PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_LIMIT',
  'PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_LIMIT',
  'PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LIMIT',
  'PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LEASE_MS',
] as const;

const OPTIONAL_CONFIG_CHECKS: ReadonlyArray<string | readonly string[]> = [
  'ADMIN_AUTH_ALLOW_INSECURE_LOCAL',
  'DB_TIMEZONE',
  'NETWORK_DDNS_DNSPOD_ENABLED',
  'NETWORK_DDNS_DNSPOD_SECRET_ID',
  'NETWORK_DDNS_DNSPOD_SECRET_KEY',
  'NETWORK_DDNS_RECONCILE_INTERVAL_MS',
  'NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS',
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
  'QQBOT_REVERSE_WS_PATH',
  'QQBOT_REVERSE_WS_TOKEN',
  'QQBOT_NAPCAT_ROOT',
  'QQBOT_NAPCAT_IMAGE',
  'QQBOT_NAPCAT_CONTAINER_MODE',
  'QQBOT_NAPCAT_SSH_TARGET',
  'QQBOT_NAPCAT_SSH_PORT',
  'QQBOT_NAPCAT_SSH_KEY_PATH',
  'NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS',
  ['QQBOT_NAPCAT_REVERSE_WS_URL', 'QQBOT_NAPCAT_REVERSE_WS_BASE'],
  ['NAPCAT_WEBUI_BASE_URL', 'QQBOT_NAPCAT_WEBUI_URL'],
  ['NAPCAT_WEBUI_TOKEN', 'QQBOT_NAPCAT_WEBUI_TOKEN'],
];

@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 按当前运行态读取针对运行态健康检查；从 `getString` 读取针对运行态健康检查。
   * @returns 包含 `nodeEnv`、`port` 字段的针对运行态健康检查。
   */
  readAppProfile(): RuntimeAppConfig {
    return {
      nodeEnv: this.getString('NODE_ENV', 'development'),
      port: 48085,
    };
  }

  /**
   * 按当前运行态读取针对运行态健康检查；从 `getString` 读取针对运行态健康检查。
   * @returns 包含 `host`、`port`、`database`、`username`、`synchronize` 字段的针对运行态健康检查。
   */
  readDatabaseProfile(): RuntimeDatabaseConfig {
    return {
      host: this.getString('DB_HOST'),
      port: this.getPositiveNumber('DB_PORT', 3306),
      database: this.getString('DB_DATABASE'),
      username: this.getString('DB_USERNAME'),
      synchronize: this.getBoolean('DB_SYNC', false),
      timezone: this.getString('DB_TIMEZONE', '+08:00'),
    };
  }

  /**
   * 按当前运行态读取针对运行态健康检查；从 `getFirstString` 读取针对运行态健康检查。
   * @returns 包含 `transportEnabled`、`httpRequestPushEnabled`、`queryConfigured`、`host`、`queryHost` 字段的针对运行态健康检查。
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
   * 按当前运行态读取针对运行态健康检查；从 `getString` 读取针对运行态健康检查。
   * @returns 包含 `endpoint`、`port`、`useSSL`、`accessKey`、`bucket` 字段的针对运行态健康检查。
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
   * 按当前运行态读取针对运行态健康检查；从 `getString` 读取针对运行态健康检查。
   * @returns 包含 `reverseWsPath`、`reverseWsToken`、`napcatRoot`、`napcatImage`、`napcatContainerMode` 字段的针对运行态健康检查。
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
   * 从运行配置读取公网安全边界的非敏感开关、限额和计数摘要。
   * @returns 公网可信代理与限流配置摘要。
   */
  readSecurityProfile(): RuntimeSecurityConfig {
    return {
      adminAuthAllowInsecureLocal: this.getBoolean(
        'ADMIN_AUTH_ALLOW_INSECURE_LOCAL',
        false,
      ),
      baselineLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_BASELINE_LIMIT',
        300,
      ),
      live2dConcurrentLeaseMs: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LEASE_MS',
        120000,
      ),
      live2dConcurrentLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LIVE2D_CONCURRENT_LIMIT',
        8,
      ),
      loginGlobalLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_LIMIT',
        100,
      ),
      loginGlobalWindowMs: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGIN_GLOBAL_WINDOW_MS',
        60000,
      ),
      loginIpLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGIN_IP_LIMIT',
        5,
      ),
      loginIpWindowMs: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGIN_IP_WINDOW_MS',
        60000,
      ),
      loginUsernameLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGIN_USERNAME_LIMIT',
        10,
      ),
      loginUsernameWindowMs: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGIN_USERNAME_WINDOW_MS',
        900000,
      ),
      logoutSubjectLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_LIMIT',
        10,
      ),
      logoutSubjectWindowMs: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_LOGOUT_SUBJECT_WINDOW_MS',
        60000,
      ),
      publicReadLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_PUBLIC_READ_LIMIT',
        60,
      ),
      redisDb: this.getNonNegativeNumber('PUBLIC_RATE_LIMIT_REDIS_DB', 0),
      redisHost: this.getString('PUBLIC_RATE_LIMIT_REDIS_HOST', '127.0.0.1'),
      redisKeyPrefix: this.getString(
        'PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX',
        'kt:public-rate-limit',
      ),
      redisPort: this.getPositiveNumber('PUBLIC_RATE_LIMIT_REDIS_PORT', 6379),
      refreshSubjectLimit: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_LIMIT',
        30,
      ),
      refreshSubjectWindowMs: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_REFRESH_SUBJECT_WINDOW_MS',
        60000,
      ),
      swaggerAllowlistCount: this.countCsvValues(
        'PUBLIC_SECURITY_SWAGGER_ALLOWLIST',
      ),
      trustedProxyCount: this.countCsvValues(
        'PUBLIC_SECURITY_TRUSTED_PROXY_IPS',
      ),
      warningIntervalMs: this.getPositiveNumber(
        'PUBLIC_RATE_LIMIT_WARNING_INTERVAL_MS',
        30000,
      ),
      windowMs: this.getPositiveNumber('PUBLIC_RATE_LIMIT_WINDOW_MS', 60000),
    };
  }

  /**
   * 按当前运行态读取针对运行态健康检查；从 `readAppProfile` 读取针对运行态健康检查。
   * @returns 包含 `app`、`database`、`loki`、`minio`、`qqbot` 字段的针对运行态健康检查。
   */
  getSafeSnapshot(): RuntimeSafeConfigSnapshot {
    return {
      app: this.readAppProfile(),
      database: this.readDatabaseProfile(),
      loki: this.readLokiProfile(),
      minio: this.readMinioProfile(),
      qqbot: this.readQqbotProfile(),
      security: this.readSecurityProfile(),
      checks: this.getConfigChecks(),
    };
  }

  /**
   * 按当前运行态读取针对运行态健康检查。
   * @returns 按输入顺序得到的针对运行态健康检查列表；没有匹配项时为空数组。
   */
  getConfigChecks(): RuntimeConfigCheck[] {
    return [
      ...REQUIRED_CONFIG_KEYS.map((key) => this.createCheck(key, 'required')),
      ...OPTIONAL_CONFIG_CHECKS.map((check) =>
        {
          if (typeof check === 'string') {
            return this.createCheck(check, 'optional');
          }
          return this.createAnyCheck([...check], 'optional');
        },
      ),
    ];
  }

  /**
   * 将`value`中的针对运行态健康检查认证信息替换为掩码；无法解析时保留原值。
   * @param value - 参与针对运行态健康检查比较、格式化或输出的候选值。
   * @returns 认证信息已替换为掩码的针对运行态健康检查；输入为空时为 `undefined`，解析失败时保留原文本。
   */
  maskSecret(value: unknown): string {
    const text = this.toolsService.toSecretText(value);
    if (!text) return '';
    if (text.length <= 4) return '****';
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  }

  /**
   * 根据`key`、`level`构造针对运行态健康检查；从 `configService.get` 读取针对运行态健康检查。
   * @param key - 用于读取或更新针对运行态健康检查的稳定键。
   * @param level - 决定针对运行态健康检查内容、边界或目标的 `level` 值。
   * @returns 包含 `key`、`level`、`present`、`maskedValue`、`message` 字段的针对运行态健康检查。
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
      maskedValue: (() => {
        if (present) {
          return this.maskSecret(value);
        }
        return undefined;
      })(),
      message: (() => {
        if (present) {
          return undefined;
        }
        return `${key} is not configured`;
      })(),
    };
  }

  /**
   * 根据`keys`、`level`构造针对运行态健康检查；从 `getFirstString` 读取针对运行态健康检查。
   * @param keys - 决定针对运行态健康检查内容、边界或目标的 `keys` 值。
   * @param level - 决定针对运行态健康检查内容、边界或目标的 `level` 值。
   * @returns 包含 `key`、`level`、`present`、`maskedValue`、`message` 字段的针对运行态健康检查。
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
      maskedValue: (() => {
        if (present) {
          return this.maskSecret(value);
        }
        return undefined;
      })(),
      message: (() => {
        if (present) {
          return undefined;
        }
        return `${key} is not configured`;
      })(),
    };
  }

  /**
   * 按`key`、`fallback`读取针对运行态健康检查；从 `configService.get` 读取针对运行态健康检查。
   * @param key - 用于读取或更新针对运行态健康检查的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
   * @returns 规范化后的针对运行态健康检查；主值为空时采用 `fallback` 兜底。
   */
  private getString(key: string, fallback = '') {
    const value = this.toolsService.toTrimmedString(
      this.configService.get(key),
    );
    return value || fallback;
  }

  /**
   * 按`keys`、`fallback`读取针对运行态健康检查；从 `getString` 读取针对运行态健康检查。
   * @param keys - 决定针对运行态健康检查内容、边界或目标的 `keys` 值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
   * @returns 针对运行态健康检查。
   */
  private getFirstString(keys: string[], fallback = '') {
    for (const key of keys) {
      const value = this.getString(key);
      if (value) return value;
    }
    return fallback;
  }

  /**
   * 读取正数配置；配置缺失、非有限数或不大于零时使用调用方兜底值。
   * @param key - 用于读取或更新正数配置的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 返回有效正数配置；缺失或非法时返回调用方提供的兜底值。
   */
  private getPositiveNumber(key: string, fallback: number) {
    return this.toolsService.toPositiveNumber(
      this.configService.get<string | number>(key),
      fallback,
    );
  }

  /**
   * 根据参数 `key`，查询非负整数配置。
   * @param key - 用于读取或更新根据参数 `key`，查询非负整数配置的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 根据参数 `key`，查询非负整数配置。
   */
  private getNonNegativeNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<string | number>(key));
    if (Number.isInteger(value) && value >= 0) {
      return value;
    }
    return fallback;
  }

  /**
   * 根据参数 `key`，统计逗号分隔配置中的有效项目数。
   * @param key - 用于读取或更新根据参数 `key`，统计逗号分隔配置中的有效项目数的稳定键。
   * @returns 根据参数 `key`，统计逗号分隔配置中的有效项目数。
   */
  private countCsvValues(key: string) {
    return this.getString(key)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean).length;
  }

  /**
   * 按`key`、`fallback`读取针对运行态健康检查；从 `configService.get` 读取针对运行态健康检查。
   * @param key - 用于读取或更新针对运行态健康检查的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 针对运行态健康检查。
   */
  private getBoolean(key: string, fallback: boolean) {
    return this.toolsService.normalizeBoolean(
      this.configService.get<string | boolean | number>(key),
      fallback,
    );
  }
}
