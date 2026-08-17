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

/** 创建DNSPodSDK客户端。 */
function createDnsPodSdkClient(clientConfig: ClientConfig): DnsPodSdkClient {
  return new dnspod.v20210323.Client(
    clientConfig,
  ) as unknown as DnsPodSdkClient;
}

/** 判断有效DNS标签是否成立。 */
function isValidDnsLabel(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  );
}

/** 判断有效DNS名称是否成立。 */
function isValidDnsName(
  value: string,
  requireMultipleLabels: boolean,
): boolean {
  if (value.length > 253) return false;
  const labels = value.split('.');
  if (requireMultipleLabels && labels.length < 2) return false;
  return labels.every(isValidDnsLabel);
}

/** 规范化地址。 */
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
    return isIP(address) === 4 ? address : null;
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

/** 规范化期望的记录标识。 */
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

/** 规范化输入。 */
function normalizeInput(
  input: NetworkDnsPodReconcileInput,
): NormalizedReconcileInput {
  const domain =
    typeof input?.domain === 'string' ? input.domain.toLowerCase() : '';
  const subDomain =
    typeof input?.subDomain === 'string' ? input.subDomain.toLowerCase() : '';
  const recordType = input?.recordType;
  const validDomain =
    domain === input?.domain &&
    isValidDnsName(domain, true) &&
    !domain.endsWith('.');
  const validSubDomain =
    subDomain === input?.subDomain &&
    (subDomain === '@' || isValidDnsName(subDomain, false));
  const fqdnLength =
    subDomain === '@' ? domain.length : `${subDomain}.${domain}`.length;
  const targetAddress =
    recordType === 'A' || recordType === 'AAAA'
      ? normalizeAddress(input.targetAddress, recordType)
      : null;
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

/** 返回错误字符串。 */
function errorString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : '';
}

/** 返回错误HTTP状态。 */
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

/** 判断可重试的资料源错误是否成立。 */
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

/** 返回匹配结果资料源代码。 */
function matchesProviderCode(code: string, categories: string[]): boolean {
  return categories.some(
    (category) => code === category || code.startsWith(`${category}.`),
  );
}

/** 映射资料源错误。 */
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

/** 校验记录。 */
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
  if (
    !recordIdIsSafe ||
    !ttlIsSafe ||
    !lineIdIsSafe ||
    !nameMatches ||
    record.Type !== input.recordType ||
    record.Line !== DNSPOD_DEFAULT_LINE ||
    !address
  ) {
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

  /** 读取状态。 */
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

  /** 核对网络DNSPod记录。 */
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

  /** 描述精确记录。 */
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

  /** 返回客户端配置。 */
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

  /** 返回配置值。 */
  private configValue(key: string): string {
    const value = this.config.get<unknown>(key);
    return typeof value === 'string' ? value.trim() : '';
  }
}
