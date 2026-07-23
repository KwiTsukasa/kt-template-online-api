import type { ConfigService } from '@nestjs/config';
import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface';
import {
  NetworkDnsPodClient,
  NetworkDnsPodClientError,
  type NetworkDnsPodReconcileInput,
} from '../../../src/modules/admin/platform-config/network-management/network-dnspod.client';

type DescribeRecordFilterListRequest = {
  Domain: string;
  IsExactSubDomain: boolean;
  Limit: number;
  Offset: number;
  RecordLine: string[];
  RecordType: string[];
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

type MockRecord = {
  Line?: string;
  LineId?: string;
  Name?: string;
  RecordId?: number;
  Status?: string;
  TTL?: number;
  Type?: string;
  Value?: string;
};

type MockDnsPodSdkClient = {
  DescribeRecordFilterList: jest.Mock<
    Promise<{ RecordList?: MockRecord[] }>,
    [DescribeRecordFilterListRequest]
  >;
  ModifyDynamicDNS: jest.Mock<
    Promise<Record<string, never>>,
    [ModifyDynamicDNSRequest]
  >;
};

const enabledConfig = {
  NETWORK_DDNS_DNSPOD_ENABLED: 'true',
  NETWORK_DDNS_DNSPOD_SECRET_ID: 'test-secret-id',
  NETWORK_DDNS_DNSPOD_SECRET_KEY: 'test-secret-key',
};

/**
 * Creates a ConfigService-compatible readonly key/value reader.
 * @param values - Runtime values exposed to the client under test.
 * @returns Minimal ConfigService mock.
 */
function createConfig(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

/**
 * Creates a DNSPod SDK mock with successful defaults.
 * @returns Mocked DescribeRecordFilterList and ModifyDynamicDNS methods.
 */
function createSdkClient(): MockDnsPodSdkClient {
  return {
    DescribeRecordFilterList: jest.fn(),
    ModifyDynamicDNS: jest.fn().mockResolvedValue({}),
  };
}

/**
 * Creates a valid enabled DNSPod record.
 * @param overrides - Record fields replaced for a focused test.
 * @returns Provider record suitable for DescribeRecordFilterList.
 */
function createRecord(overrides: MockRecord = {}): MockRecord {
  return {
    Line: '默认',
    LineId: '0',
    Name: 'nas',
    RecordId: 123,
    Status: 'ENABLE',
    TTL: 600,
    Type: 'A',
    Value: '198.51.100.10',
    ...overrides,
  };
}

/**
 * Creates an initialized client and captures SDK factory calls.
 * @param sdkClient - SDK behavior used by the test.
 * @param values - Runtime configuration overrides.
 * @returns Client under test and its SDK factory mock.
 */
function createClient(
  sdkClient = createSdkClient(),
  values: Record<string, string | undefined> = enabledConfig,
) {
  const factory = jest.fn<MockDnsPodSdkClient, [ClientConfig]>(() => sdkClient);
  return {
    client: new NetworkDnsPodClient(createConfig(values), factory),
    factory,
    sdkClient,
  };
}

const ipv4Input: NetworkDnsPodReconcileInput = {
  domain: 'kwitsukasa.top',
  recordType: 'A',
  subDomain: 'nas',
  targetAddress: '198.51.100.10',
};

describe('NetworkDnsPodClient', () => {
  it('reports disabled or missing credentials without creating an SDK client', async () => {
    const disabled = createClient(createSdkClient(), {
      ...enabledConfig,
      NETWORK_DDNS_DNSPOD_ENABLED: 'false',
    });
    expect(disabled.client.getStatus()).toEqual({
      configured: true,
      enabled: false,
      provider: 'dnspod',
    });
    await expect(disabled.client.reconcile(ipv4Input)).rejects.toMatchObject({
      code: 'DNSPOD_DISABLED',
      retryable: false,
    });
    expect(disabled.factory).not.toHaveBeenCalled();

    const missing = createClient(createSdkClient(), {
      NETWORK_DDNS_DNSPOD_ENABLED: 'true',
      NETWORK_DDNS_DNSPOD_SECRET_ID: '',
      NETWORK_DDNS_DNSPOD_SECRET_KEY: undefined,
    });
    expect(missing.client.getStatus()).toEqual({
      configured: false,
      enabled: true,
      provider: 'dnspod',
    });
    await expect(missing.client.reconcile(ipv4Input)).rejects.toMatchObject({
      code: 'DNSPOD_NOT_CONFIGURED',
      retryable: false,
    });
    expect(missing.factory).not.toHaveBeenCalled();
  });

  it('uses the exact root-host IPv4 list request and a bounded SDK profile', async () => {
    const { client, factory, sdkClient } = createClient();
    sdkClient.DescribeRecordFilterList.mockResolvedValue({
      RecordList: [
        createRecord({
          Name: '@',
          Value: '198.51.100.10',
        }),
      ],
    });

    await expect(
      client.reconcile({
        ...ipv4Input,
        subDomain: '@',
      }),
    ).resolves.toEqual({
      appliedAddress: '198.51.100.10',
      changed: false,
      providerRecordId: '123',
    });

    expect(sdkClient.DescribeRecordFilterList).toHaveBeenCalledWith({
      Domain: 'kwitsukasa.top',
      IsExactSubDomain: true,
      Limit: 2,
      Offset: 0,
      RecordLine: ['0'],
      RecordType: ['A'],
      SubDomain: '@',
    });
    expect(sdkClient.ModifyDynamicDNS).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1);
    const config = factory.mock.calls[0][0];
    expect(config.region).toBeUndefined();
    expect(config.profile?.httpProfile).toEqual({
      endpoint: 'dnspod.tencentcloudapi.com',
      reqTimeout: 10,
    });
  });

  it('uses the exact normal-host IPv6 list request and canonicalizes equality', async () => {
    const { client, sdkClient } = createClient();
    sdkClient.DescribeRecordFilterList.mockResolvedValue({
      RecordList: [
        createRecord({
          Name: 'nas6',
          Type: 'AAAA',
          Value: '2409:8a31:05e1:6020:a5ea:838e:843f:be5e',
        }),
      ],
    });

    await expect(
      client.reconcile({
        domain: 'kwitsukasa.top',
        recordType: 'AAAA',
        subDomain: 'nas6',
        targetAddress: '2409:8a31:5e1:6020:a5ea:838e:843f:be5e',
      }),
    ).resolves.toEqual({
      appliedAddress: '2409:8a31:5e1:6020:a5ea:838e:843f:be5e',
      changed: false,
      providerRecordId: '123',
    });

    expect(sdkClient.DescribeRecordFilterList).toHaveBeenCalledWith({
      Domain: 'kwitsukasa.top',
      IsExactSubDomain: true,
      Limit: 2,
      Offset: 0,
      RecordLine: ['0'],
      RecordType: ['AAAA'],
      SubDomain: 'nas6',
    });
    expect(sdkClient.ModifyDynamicDNS).not.toHaveBeenCalled();
  });

  it('updates IPv4 without changing record metadata and verifies the read-back', async () => {
    const { client, sdkClient } = createClient();
    sdkClient.DescribeRecordFilterList.mockResolvedValueOnce({
      RecordList: [
        createRecord({
          LineId: '10=1',
          Value: '198.51.100.9',
        }),
      ],
    }).mockResolvedValueOnce({
      RecordList: [
        createRecord({
          LineId: '10=1',
          Value: '198.51.100.10',
        }),
      ],
    });

    await expect(
      client.reconcile({
        ...ipv4Input,
        expectedRecordId: '123',
      }),
    ).resolves.toEqual({
      appliedAddress: '198.51.100.10',
      changed: true,
      providerRecordId: '123',
    });

    expect(sdkClient.ModifyDynamicDNS).toHaveBeenCalledTimes(1);
    expect(sdkClient.ModifyDynamicDNS).toHaveBeenCalledWith({
      Domain: 'kwitsukasa.top',
      RecordId: 123,
      RecordLine: '默认',
      RecordLineId: '10=1',
      SubDomain: 'nas',
      Ttl: 600,
      Value: '198.51.100.10',
    });
    expect(sdkClient.DescribeRecordFilterList).toHaveBeenCalledTimes(2);
  });

  it('updates IPv6 without changing record metadata and verifies the read-back', async () => {
    const { client, sdkClient } = createClient();
    sdkClient.DescribeRecordFilterList.mockResolvedValueOnce({
      RecordList: [
        createRecord({
          Name: 'nas6',
          Type: 'AAAA',
          Value: '2409:8a31:5e1:6020::1',
        }),
      ],
    }).mockResolvedValueOnce({
      RecordList: [
        createRecord({
          Name: 'nas6',
          Type: 'AAAA',
          Value: '2409:8a31:5e1:6020::2',
        }),
      ],
    });

    await expect(
      client.reconcile({
        domain: 'kwitsukasa.top',
        expectedRecordId: '123',
        recordType: 'AAAA',
        subDomain: 'nas6',
        targetAddress: '2409:8a31:5e1:6020::2',
      }),
    ).resolves.toEqual({
      appliedAddress: '2409:8a31:5e1:6020::2',
      changed: true,
      providerRecordId: '123',
    });

    expect(sdkClient.ModifyDynamicDNS).toHaveBeenCalledWith({
      Domain: 'kwitsukasa.top',
      RecordId: 123,
      RecordLine: '默认',
      RecordLineId: '0',
      SubDomain: 'nas6',
      Ttl: 600,
      Value: '2409:8a31:5e1:6020::2',
    });
  });

  it.each([
    ['missing record', [], 'DNSPOD_RECORD_NOT_FOUND'],
    [
      'ambiguous records',
      [createRecord(), createRecord({ RecordId: 124 })],
      'DNSPOD_RECORD_AMBIGUOUS',
    ],
    [
      'disabled record',
      [createRecord({ Status: 'DISABLE' })],
      'DNSPOD_RECORD_DISABLED',
    ],
    [
      'wrong record type',
      [createRecord({ Type: 'CNAME' })],
      'DNSPOD_RECORD_INVALID',
    ],
    ['wrong line', [createRecord({ Line: '境外' })], 'DNSPOD_RECORD_INVALID'],
    [
      'unsafe record ID',
      [createRecord({ RecordId: Number.MAX_SAFE_INTEGER + 1 })],
      'DNSPOD_RECORD_INVALID',
    ],
    [
      'different expected record ID',
      [createRecord({ RecordId: 124 })],
      'DNSPOD_RECORD_MISMATCH',
    ],
    [
      'wrong address family',
      [createRecord({ Value: '2409:8a31:5e1:6020::1' })],
      'DNSPOD_RECORD_INVALID',
    ],
  ])('fails closed for %s', async (_name, records, code) => {
    const { client, sdkClient } = createClient();
    sdkClient.DescribeRecordFilterList.mockResolvedValue({
      RecordList: records,
    });

    await expect(
      client.reconcile({
        ...ipv4Input,
        expectedRecordId: code === 'DNSPOD_RECORD_MISMATCH' ? '123' : undefined,
      }),
    ).rejects.toMatchObject({
      code,
      retryable: false,
    });
    expect(sdkClient.ModifyDynamicDNS).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...ipv4Input, domain: 'https://kwitsukasa.top' }],
    [{ ...ipv4Input, domain: 'kwitsukasa.top:53' }],
    [{ ...ipv4Input, subDomain: '' }],
    [{ ...ipv4Input, subDomain: '*.nas' }],
    [{ ...ipv4Input, targetAddress: '198.51.100.10:8211' }],
    [
      {
        ...ipv4Input,
        recordType: 'A' as const,
        targetAddress: '2409:8a31:5e1:6020::1',
      },
    ],
    [
      {
        ...ipv4Input,
        recordType: 'AAAA' as const,
        targetAddress: '198.51.100.10',
      },
    ],
    [
      {
        ...ipv4Input,
        recordType: 'AAAA' as const,
        targetAddress: '::',
      },
    ],
    [
      {
        ...ipv4Input,
        recordType: 'AAAA' as const,
        targetAddress: '::1',
      },
    ],
    [
      {
        ...ipv4Input,
        recordType: 'AAAA' as const,
        targetAddress: 'fe80::1',
      },
    ],
    [
      {
        ...ipv4Input,
        recordType: 'AAAA' as const,
        targetAddress: 'fd00::1',
      },
    ],
    [
      {
        ...ipv4Input,
        recordType: 'AAAA' as const,
        targetAddress: 'ff02::1',
      },
    ],
    [
      {
        ...ipv4Input,
        recordType: 'AAAA' as const,
        targetAddress: '::ffff:198.51.100.10',
      },
    ],
    [{ ...ipv4Input, expectedRecordId: '9007199254740992' }],
    [
      {
        ...ipv4Input,
        expectedRecordId: 123 as unknown as string,
      },
    ],
  ])(
    'rejects invalid input before creating the SDK client: %j',
    async (input) => {
      const { client, factory } = createClient();

      await expect(client.reconcile(input)).rejects.toMatchObject({
        code: 'DNSPOD_INVALID_INPUT',
        retryable: false,
      });
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { code: 'RequestLimitExceeded', message: 'raw' },
      'DNSPOD_RATE_LIMITED',
      'DNSPod provider request was rate limited',
      true,
    ],
    [
      { code: 'InternalError', message: 'raw' },
      'DNSPOD_PROVIDER_RETRYABLE',
      'DNSPod provider request failed temporarily',
      true,
    ],
    [
      { code: 'ETIMEDOUT', message: 'raw' },
      'DNSPOD_PROVIDER_RETRYABLE',
      'DNSPod provider request failed temporarily',
      true,
    ],
    [
      { message: 'raw', statusCode: 503 },
      'DNSPOD_PROVIDER_RETRYABLE',
      'DNSPod provider request failed temporarily',
      true,
    ],
    [
      { code: 'AuthFailure.SecretIdNotFound', message: 'raw' },
      'DNSPOD_AUTH_FAILED',
      'DNSPod provider authentication failed',
      false,
    ],
    [
      { code: 'UnauthorizedOperation', message: 'raw' },
      'DNSPOD_PERMISSION_DENIED',
      'DNSPod provider permission was denied',
      false,
    ],
    [
      { code: 'AuthFailure.UnauthorizedOperation', message: 'raw' },
      'DNSPOD_PERMISSION_DENIED',
      'DNSPod provider permission was denied',
      false,
    ],
  ])(
    'maps one SDK failure to redacted stable code %s',
    async (error, code, message, retryable) => {
      const { client, sdkClient } = createClient();
      sdkClient.DescribeRecordFilterList.mockRejectedValue(error);

      await expect(client.reconcile(ipv4Input)).rejects.toMatchObject({
        code,
        message,
        retryable,
      });
    },
  );

  it('maps uncategorized permanent SDK failures to one redacted stable error', async () => {
    const { client, sdkClient } = createClient();
    sdkClient.DescribeRecordFilterList.mockRejectedValue({
      code: 'InvalidParameter',
      message: 'the raw provider rejection must stay private',
      requestId: 'provider-request-id',
    });

    await expect(client.reconcile(ipv4Input)).rejects.toMatchObject({
      code: 'DNSPOD_PROVIDER_REJECTED',
      message: 'DNSPod provider request was rejected',
      retryable: false,
    });
  });

  it('keeps serialized failures and results free of credentials, provider details, FQDN, and ports', async () => {
    const secretId = 'sensitive-secret-id';
    const secretKey = 'sensitive-secret-key';
    const domain = 'private.example.com';
    const subDomain = 'hidden';
    const rawMessage = `provider leaked ${secretId} ${secretKey} ${subDomain}.${domain} 198.51.100.10:8211`;
    const failing = createClient(createSdkClient(), {
      NETWORK_DDNS_DNSPOD_ENABLED: 'true',
      NETWORK_DDNS_DNSPOD_SECRET_ID: secretId,
      NETWORK_DDNS_DNSPOD_SECRET_KEY: secretKey,
    });
    failing.sdkClient.DescribeRecordFilterList.mockRejectedValue({
      code: 'AuthFailure',
      message: rawMessage,
    });

    let caught: unknown;
    try {
      await failing.client.reconcile({
        domain,
        recordType: 'A',
        subDomain,
        targetAddress: '198.51.100.10',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NetworkDnsPodClientError);
    const serializedError = JSON.stringify({
      ...(caught as NetworkDnsPodClientError),
      message: (caught as NetworkDnsPodClientError).message,
    });
    for (const forbidden of [
      secretId,
      secretKey,
      rawMessage,
      `${subDomain}.${domain}`,
      '198.51.100.10:8211',
    ]) {
      expect(serializedError).not.toContain(forbidden);
    }

    const successful = createClient();
    successful.sdkClient.DescribeRecordFilterList.mockResolvedValue({
      RecordList: [createRecord()],
    });
    const serializedResult = JSON.stringify(
      await successful.client.reconcile(ipv4Input),
    );
    expect(serializedResult).not.toContain('test-secret-id');
    expect(serializedResult).not.toContain('test-secret-key');
    expect(serializedResult).not.toContain('nas.kwitsukasa.top');
    expect(serializedResult).not.toContain('198.51.100.10:8211');
  });
});
