import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface';
import { dnspod } from 'tencentcloud-sdk-nodejs/tencentcloud/services/dnspod';
import type { DescribeRecordFilterListRequest as TencentDescribeRecordFilterListRequest } from 'tencentcloud-sdk-nodejs/tencentcloud/services/dnspod/v20210323/dnspod_models';

export type NetworkDnsPodProviderStatus = {
  configured: boolean;
  enabled: boolean;
  provider: 'dnspod';
};

export type NetworkDnsPodReconcileInput = {
  domain: string;
  expectedRecordId?: null | string;
  recordType: 'A' | 'AAAA';
  subDomain: string;
  targetAddress: string;
};

export type NetworkDnsPodReconcileResult = {
  appliedAddress: string;
  changed: boolean;
  providerRecordId: string;
};

type DnsPodRecord = {
  Line?: string;
  LineId?: string;
  Name?: string;
  RecordId?: number;
  Status?: string;
  TTL?: number;
  Type?: string;
  Value?: string;
};

type DescribeRecordFilterListRequest =
  TencentDescribeRecordFilterListRequest & {
    Domain: string;
    IsExactSubDomain: true;
    Limit: 2;
    Offset: 0;
    RecordLine: string[];
    RecordType: Array<'A' | 'AAAA'>;
    SubDomain: string;
  };

type ModifyDynamicDNSRequest = {
  Domain: string;
  RecordId: number;
  RecordLine: string;
  RecordLineId: string;
  SubDomain: string;
  Ttl: number;
  Value: string;
};

interface DnsPodSdkClient {
  DescribeRecordFilterList(request: DescribeRecordFilterListRequest): Promise<{
    RecordList?: DnsPodRecord[];
  }>;
  ModifyDynamicDNS(
    request: ModifyDynamicDNSRequest,
  ): Promise<Record<string, unknown>>;
}

export type NetworkDnsPodClientFactory = (
  clientConfig: ClientConfig,
) => DnsPodSdkClient;

type NormalizedReconcileInput = {
  domain: string;
  expectedRecordId: null | string;
  recordType: 'A' | 'AAAA';
  subDomain: string;
  targetAddress: string;
};

type ValidatedRecord = {
  address: string;
  line: string;
  lineId: string;
  recordId: number;
  recordIdText: string;
  ttl: number;
};

const DNSPOD_ENDPOINT = 'dnspod.tencentcloudapi.com';
const DNSPOD_REQUEST_TIMEOUT_SECONDS = 10;
const DNSPOD_DEFAULT_LINE = '默认';
const MAX_DNSPOD_TTL = 604_800;
const MAX_SAFE_RECORD_ID = BigInt(Number.MAX_SAFE_INTEGER);
const RETRYABLE_PROVIDER_CODES = [
  'InternalError',
  'ServerUnavailable',
  'ServiceUnavailable',
];
const PROVIDER_AUTH_CODES = ['AuthFailure'];
const PROVIDER_PERMISSION_CODES = [
  'AuthFailure.UnauthorizedOperation',
  'FailedOperation.NoPermission',
  'OperationDenied',
  'UnauthorizedOperation',
];
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

export class NetworkDnsPodClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'NetworkDnsPodClientError';
  }
}

/**
 * 用 DNSPod 凭据、端点与区域配置创建 SDK 客户端，供记录查询和变更调用复用。
 * @param clientConfig - 限定DNSPodSDK客户端边界、地址与开关的运行配置。
 * @returns 完成初始化并携带当前边界配置的DNSPodSDK客户端。
 */
function createDnsPodSdkClient(clientConfig: ClientConfig): DnsPodSdkClient {
  return new dnspod.v20210323.Client(
    clientConfig,
  ) as unknown as DnsPodSdkClient;
}

/**
 * 根据`value`与当前约束判定有效DNS标签。
 * @param value - 待判定是否满足有效DNS标签约束的候选值。
 * @returns 满足有效DNS标签约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isValidDnsLabel(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  );
}

/**
 * 根据`value`、`requireMultipleLabels`与当前约束判定有效DNS名称。
 * @param value - 待判定是否满足有效DNS名称约束的候选值。
 * @param requireMultipleLabels - 决定是否启用“MultipleLabels”分支的布尔选项。
 * @returns 满足有效DNS名称约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isValidDnsName(
  value: string,
  requireMultipleLabels: boolean,
): boolean {
  if (value.length > 253) return false;
  const labels = value.split('.');
  if (requireMultipleLabels && labels.length < 2) return false;
  return labels.every(isValidDnsLabel);
}

/**
 * 将`address`、`recordType`规范为地址，使等价输入得到一致表示；当 `typeof address !== 'string' || address.length === 0 || addres…` 成立时返回 `null`。
 * @param address - 用于地址的领域对象，包含 `length` 字段。
 * @param recordType - 决定地址内容、边界或目标的 `recordType` 值。
 * @returns 地址；无法解析或未命中时为 `null`。
 */
function normalizeAddress(
  address: unknown,
  recordType: 'A' | 'AAAA',
): null | string {
  if (
    typeof address !== 'string' ||
    address.length === 0 ||
    address !== address.trim()
  ) {
    return null;
  }
  if (recordType === 'A') {
    if (isIP(address) === 4) {
      return address;
    }
    return null;
  }
  if (isIP(address) !== 6) return null;

  let canonicalAddress: string;
  try {
    const hostname = new URL(`http://[${address}]/`).hostname;
    canonicalAddress = hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }

  const firstHextet = Number.parseInt(canonicalAddress.split(':', 1)[0], 16);
  if (
    !Number.isInteger(firstHextet) ||
    firstHextet < 0x2000 ||
    firstHextet > 0x3fff
  ) {
    return null;
  }
  return canonicalAddress;
}

/**
 * 将`value`规范为期望的记录标识，使等价输入得到一致表示。
 * @param value - 待转换为期望的记录标识的原始值。
 * @returns 期望的记录标识；无法解析或未命中时为 `null`。
 * @throws 当 `typeof value !== 'string' || !/^[1-9]\d*$/.test(value)` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`；
 *   当 `numericValue > MAX_SAFE_RECORD_ID` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`。
 */
function normalizeExpectedRecordId(
  value: NetworkDnsPodReconcileInput['expectedRecordId'],
): null | string {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_INVALID_INPUT',
      'DNSPod reconcile input is invalid',
      false,
    );
  }
  const numericValue = BigInt(value);
  if (numericValue > MAX_SAFE_RECORD_ID) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_INVALID_INPUT',
      'DNSPod reconcile input is invalid',
      false,
    );
  }
  return numericValue.toString();
}

/**
 * 将`input`规范为输入，使等价输入得到一致表示。
 * @param input - 用于输入的结构化输入，包含 `domain`、`subDomain`、`recordType`、`targetAddress` 字段。
 * @returns 包含 `domain`、`expectedRecordId`、`recordType`、`subDomain`、`targetAddress` 字段的输入。
 * @throws 当 `!validDomain || !validSubDomain || fqdnLength > 253 || !targetAddress` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`。
 */
function normalizeInput(
  input: NetworkDnsPodReconcileInput,
): NormalizedReconcileInput {
  const domain = (() => {
    if (typeof input?.domain === 'string') {
      return input.domain.toLowerCase();
    }
    return '';
  })();
  const subDomain = (() => {
    if (typeof input?.subDomain === 'string') {
      return input.subDomain.toLowerCase();
    }
    return '';
  })();
  const recordType = input?.recordType;
  const validDomain =
    domain === input?.domain &&
    isValidDnsName(domain, true) &&
    !domain.endsWith('.');
  const validSubDomain =
    subDomain === input?.subDomain &&
    (subDomain === '@' || isValidDnsName(subDomain, false));
  const fqdnLength = (() => {
    if (subDomain === '@') {
      return domain.length;
    }
    return `${subDomain}.${domain}`.length;
  })();
  const targetAddress = (() => {
    if (recordType === 'A' || recordType === 'AAAA') {
      return normalizeAddress(input.targetAddress, recordType);
    }
    return null;
  })();
  if (!validDomain || !validSubDomain || fqdnLength > 253 || !targetAddress) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_INVALID_INPUT',
      'DNSPod reconcile input is invalid',
      false,
    );
  }
  return {
    domain,
    expectedRecordId: normalizeExpectedRecordId(input.expectedRecordId),
    recordType,
    subDomain,
    targetAddress,
  };
}

/**
 * 从未知错误对象读取指定字段；字段缺失或不是字符串时返回空串。
 * @param value - 参与从未知错误对象读取指定字段比较、格式化或输出的候选值。
 * @param key - 用于读取或更新从未知错误对象读取指定字段的稳定键。
 * @returns 当前状态对应的从未知错误对象读取指定字段，取值为 `''`。
 */
function errorString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const property = (value as Record<string, unknown>)[key];
  if (typeof property === 'string') {
    return property;
  }
  return '';
}

/**
 * 按输入分支映射错误HTTP状态。
 * @param value - 参与按输入分支映射错误HTTP状态比较、格式化或输出的候选值。
 * @returns 当前状态对应的按输入分支映射错误HTTP状态，取值为 `0`。
 */
function errorHttpStatus(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  for (const key of ['statusCode', 'status', 'httpCode']) {
    const status = record[key];
    if (typeof status === 'number') return status;
  }
  const response = record.response;
  if (response && typeof response === 'object') {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === 'number') return status;
  }
  return 0;
}

/**
 * 根据`error`与当前约束判定可重试的资料源错误。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 满足可重试的资料源错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isRetryableProviderError(error: unknown): boolean {
  const code = errorString(error, 'code');
  const name = errorString(error, 'name');
  const status = errorHttpStatus(error);
  return (
    RETRYABLE_PROVIDER_CODES.some(
      (prefix) => code === prefix || code.startsWith(`${prefix}.`),
    ) ||
    RETRYABLE_NETWORK_CODES.has(code.toUpperCase()) ||
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    status === 429 ||
    status >= 500
  );
}

/**
 * 按当前约束判定匹配结果资料源代码。
 * @param code - 决定匹配结果资料源代码内容、边界或目标的 `code` 值。
 * @param categories - 决定匹配结果资料源代码内容、边界或目标的 `categories` 值。
 * @returns 满足匹配结果资料源代码约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function matchesProviderCode(code: string, categories: string[]): boolean {
  return categories.some(
    (category) => code === category || code.startsWith(`${category}.`),
  );
}

/**
 * 将`error`转换为资料源错误；当 `matchesProviderCode(code, ['RequestLimitExceeded']) || status…` 成立时返回 `new NetworkDnsPodClientError( 'DNSPOD_RATE_…`。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 完成初始化并携带当前边界配置的资料源错误。
 */
function mapProviderError(error: unknown): NetworkDnsPodClientError {
  const code = errorString(error, 'code');
  const status = errorHttpStatus(error);
  if (matchesProviderCode(code, ['RequestLimitExceeded']) || status === 429) {
    return new NetworkDnsPodClientError(
      'DNSPOD_RATE_LIMITED',
      'DNSPod provider request was rate limited',
      true,
    );
  }
  if (matchesProviderCode(code, PROVIDER_PERMISSION_CODES)) {
    return new NetworkDnsPodClientError(
      'DNSPOD_PERMISSION_DENIED',
      'DNSPod provider permission was denied',
      false,
    );
  }
  if (matchesProviderCode(code, PROVIDER_AUTH_CODES)) {
    return new NetworkDnsPodClientError(
      'DNSPOD_AUTH_FAILED',
      'DNSPod provider authentication failed',
      false,
    );
  }
  if (isRetryableProviderError(error)) {
    return new NetworkDnsPodClientError(
      'DNSPOD_PROVIDER_RETRYABLE',
      'DNSPod provider request failed temporarily',
      true,
    );
  }
  return new NetworkDnsPodClientError(
    'DNSPOD_PROVIDER_REJECTED',
    'DNSPod provider request was rejected',
    false,
  );
}

/**
 * 校验`records`、`input`是否满足网络管理记录约束，并拒绝不合法输入。
 * @param records - 按原有顺序参与网络管理记录筛选、合并或汇总的集合。
 * @param input - 用于网络管理记录的结构化输入，包含 `subDomain`、`recordType`、`expectedRecordId` 字段。
 * @returns 包含 `address`、`line`、`lineId`、`recordId`、`recordIdText` 字段的网络管理记录。
 * @throws 当 `!Array.isArray(records) || records.length === 0` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`；当 `records.length !== 1` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`；
 *   当 `record.Status !== 'ENABLE'` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`；当 `!recordIdIsSafe || !ttlIsSafe || !lineIdIsSafe` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`；
 *   当 `!nameMatches || record.Type !== input.recordType` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`；
 *   当 `record.Line !== DNSPOD_DEFAULT_LINE || !address` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`；
 *   当 `input.expectedRecordId !== null && input.expectedRecordId !== recordIdT…` 成立时拒绝当前输入并抛出 `NetworkDnsPodClientError`。
 */
function validateRecord(
  records: DnsPodRecord[] | undefined,
  input: NormalizedReconcileInput,
): ValidatedRecord {
  if (!Array.isArray(records) || records.length === 0) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_RECORD_NOT_FOUND',
      'DNSPod address record was not found',
      false,
    );
  }
  if (records.length !== 1) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_RECORD_AMBIGUOUS',
      'DNSPod address record is ambiguous',
      false,
    );
  }

  const record = records[0];
  if (record.Status !== 'ENABLE') {
    throw new NetworkDnsPodClientError(
      'DNSPOD_RECORD_DISABLED',
      'DNSPod address record is disabled',
      false,
    );
  }

  const recordId = record.RecordId;
  const recordIdIsSafe =
    typeof recordId === 'number' &&
    Number.isSafeInteger(recordId) &&
    recordId > 0;
  const ttlIsSafe =
    typeof record.TTL === 'number' &&
    Number.isSafeInteger(record.TTL) &&
    record.TTL >= 1 &&
    record.TTL <= MAX_DNSPOD_TTL;
  const lineIdIsSafe =
    typeof record.LineId === 'string' &&
    /^[A-Za-z0-9=_:-]{1,64}$/.test(record.LineId);
  const nameMatches =
    typeof record.Name === 'string' &&
    record.Name.toLowerCase() === input.subDomain;
  const address = normalizeAddress(record.Value, input.recordType);
  if (!recordIdIsSafe || !ttlIsSafe || !lineIdIsSafe) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_RECORD_INVALID',
      'DNSPod address record metadata is invalid',
      false,
    );
  }
  if (!nameMatches || record.Type !== input.recordType) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_RECORD_INVALID',
      'DNSPod address record metadata is invalid',
      false,
    );
  }
  if (record.Line !== DNSPOD_DEFAULT_LINE || !address) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_RECORD_INVALID',
      'DNSPod address record metadata is invalid',
      false,
    );
  }

  const recordIdText = String(recordId);
  if (
    input.expectedRecordId !== null &&
    input.expectedRecordId !== recordIdText
  ) {
    throw new NetworkDnsPodClientError(
      'DNSPOD_RECORD_MISMATCH',
      'DNSPod address record identity changed',
      false,
    );
  }
  return {
    address,
    line: record.Line,
    lineId: record.LineId,
    recordId,
    recordIdText,
    ttl: record.TTL,
  };
}

@Injectable()
export class NetworkDnsPodClient {
  private readonly createClient: NetworkDnsPodClientFactory;

  constructor(
    private readonly config: ConfigService,
    @Optional() createClient?: NetworkDnsPodClientFactory,
  ) {
    this.createClient = createClient || createDnsPodSdkClient;
  }

  /**
   * 按当前运行态读取状态。
   * @returns 包含 `configured`、`enabled`、`provider` 字段的状态。
   */
  getStatus(): NetworkDnsPodProviderStatus {
    return {
      configured:
        this.configValue('NETWORK_DDNS_DNSPOD_SECRET_ID').length > 0 &&
        this.configValue('NETWORK_DDNS_DNSPOD_SECRET_KEY').length > 0,
      enabled:
        this.configValue('NETWORK_DDNS_DNSPOD_ENABLED').toLowerCase() ===
        'true',
      provider: 'dnspod',
    };
  }

  /**
   * 根据`input`处理网络DNSPod记录；当 `current.address === normalizedInput.targetAddress` 成立时返回 `{ appliedAddress: normalizedInput.targetAdd…`。
   * @param input - 用于网络DNSPod记录的结构化输入。
   * @returns 包含 `appliedAddress`、`changed`、`providerRecordId` 字段的网络DNSPod记录。
   * @throws DNSPod 未启用或凭据未配置时拒绝执行；查询、更新或回读失败会映射为服务商错误，回读地址不一致时抛出验证失败错误。
   */
  async reconcile(
    input: NetworkDnsPodReconcileInput,
  ): Promise<NetworkDnsPodReconcileResult> {
    const normalizedInput = normalizeInput(input);
    const status = this.getStatus();
    if (!status.enabled) {
      throw new NetworkDnsPodClientError(
        'DNSPOD_DISABLED',
        'DNSPod provider is disabled',
        false,
      );
    }
    if (!status.configured) {
      throw new NetworkDnsPodClientError(
        'DNSPOD_NOT_CONFIGURED',
        'DNSPod provider is not configured',
        false,
      );
    }

    const client = this.createClient(this.clientConfig());
    try {
      const current = await this.describeExactRecord(client, normalizedInput);
      if (current.address === normalizedInput.targetAddress) {
        return {
          appliedAddress: normalizedInput.targetAddress,
          changed: false,
          providerRecordId: current.recordIdText,
        };
      }

      await client.ModifyDynamicDNS({
        Domain: normalizedInput.domain,
        RecordId: current.recordId,
        RecordLine: current.line,
        RecordLineId: current.lineId,
        SubDomain: normalizedInput.subDomain,
        Ttl: current.ttl,
        Value: normalizedInput.targetAddress,
      });
      const verified = await this.describeExactRecord(client, {
        ...normalizedInput,
        expectedRecordId: current.recordIdText,
      });
      if (verified.address !== normalizedInput.targetAddress) {
        throw new NetworkDnsPodClientError(
          'DNSPOD_VERIFICATION_FAILED',
          'DNSPod address record verification failed',
          false,
        );
      }
      return {
        appliedAddress: normalizedInput.targetAddress,
        changed: true,
        providerRecordId: current.recordIdText,
      };
    } catch (error) {
      if (error instanceof NetworkDnsPodClientError) throw error;
      throw mapProviderError(error);
    }
  }

  /**
   * 根据`client`、`input`处理描述精确记录；先通过 `validateRecord` 校验输入边界。
   * @param client - 用于描述精确记录的领域对象，包含 `DescribeRecordFilterList` 字段。
   * @param input - 用于描述精确记录的结构化输入，包含 `domain`、`recordType`、`subDomain` 字段。
   * @returns 描述精确记录。
   */
  private async describeExactRecord(
    client: DnsPodSdkClient,
    input: NormalizedReconcileInput,
  ): Promise<ValidatedRecord> {
    const request: DescribeRecordFilterListRequest = {
      Domain: input.domain,
      IsExactSubDomain: true,
      Limit: 2,
      Offset: 0,
      RecordLine: ['0'],
      RecordType: [input.recordType],
      SubDomain: input.subDomain,
    };
    const response = await client.DescribeRecordFilterList(request);
    return validateRecord(response.RecordList, input);
  }

  /**
   * 读取并裁剪 DNSPod 访问密钥，构造带固定服务端点与请求超时的 SDK 客户端配置。
   * @returns DNSPod 客户端配置；缺失或非字符串密钥会以空字符串写入凭据字段。
   */
  private clientConfig(): ClientConfig {
    return {
      credential: {
        secretId: this.configValue('NETWORK_DDNS_DNSPOD_SECRET_ID'),
        secretKey: this.configValue('NETWORK_DDNS_DNSPOD_SECRET_KEY'),
      },
      profile: {
        httpProfile: {
          endpoint: DNSPOD_ENDPOINT,
          reqTimeout: DNSPOD_REQUEST_TIMEOUT_SECONDS,
        },
      },
    };
  }

  /**
   * 根据`key`处理并裁剪配置值；当 `typeof value === 'string'` 成立时返回 `value.trim()`。
   * @param key - 用于读取或更新并裁剪配置值的稳定键。
   * @returns 当前状态对应的并裁剪配置值，取值为 `''`。
   */
  private configValue(key: string): string {
    const value = this.config.get<unknown>(key);
    if (typeof value === 'string') {
      return value.trim();
    }
    return '';
  }
}
