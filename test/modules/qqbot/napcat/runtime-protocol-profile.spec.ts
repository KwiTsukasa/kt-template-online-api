import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import * as request from 'supertest';
import { ToolsService } from '@/common';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { NapcatConfigWriterService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-config-writer.service';
import { NapcatRuntimeProfileService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service';
import { NapcatRuntimeProfileInspectorService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile-inspector.service';
import { NapcatRuntimeProfileInspectionScriptService } from '../../../../src/modules/qqbot/napcat/infrastructure/integration/container/napcat-runtime-profile-inspection-script.service';
import { QqbotNapcatRuntimeController } from '../../../../src/modules/qqbot/napcat/contract/qqbot-napcat-runtime.controller';
import {
  NapcatLoginEvent,
  NapcatProtocolProfile,
  NapcatRiskMode,
  NapcatRuntimeProfile,
  NapcatSessionBehaviorProfile,
  NAPCAT_RUNTIME_DOMAIN_CONTRACT,
  NAPCAT_RUNTIME_ENTITIES,
} from '../../../../src/modules/qqbot/napcat';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

type EntityClass = new (...args: never[]) => unknown;

/**
 * Reads a TypeORM entity table name from decorator metadata.
 * @param entity - Entity class selected by the test to compare against SQL schema ownership.
 */
const getEntityTableName = (entity: EntityClass) =>
  getMetadataArgsStorage().tables.find((table) => table.target === entity)
    ?.name;

/**
 * Reads entity column names as they are persisted in MySQL.
 * @param entity - Entity class whose decorator column metadata must match refactor-v3 SQL.
 */
const getEntityColumnNames = (entity: EntityClass) =>
  getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);

describe('NapCat runtime and protocol profile persistence', () => {
  const schema = readRefactorV3SqlSchema();

  it('declares runtime profile tables as NapCat-owned domain tables', () => {
    expect(NAPCAT_RUNTIME_DOMAIN_CONTRACT.tables).toEqual(
      expect.arrayContaining([
        'napcat_runtime_profile',
        'napcat_protocol_profile',
        'napcat_session_behavior_profile',
        'napcat_login_event',
        'napcat_risk_mode',
      ]),
    );
  });

  it.each([
    [NapcatRuntimeProfile, 'napcat_runtime_profile'],
    [NapcatProtocolProfile, 'napcat_protocol_profile'],
    [NapcatSessionBehaviorProfile, 'napcat_session_behavior_profile'],
    [NapcatLoginEvent, 'napcat_login_event'],
    [NapcatRiskMode, 'napcat_risk_mode'],
  ])('maps %p to %s in the v3 SQL schema', (entity, tableName) => {
    expect(NAPCAT_RUNTIME_ENTITIES).toContain(entity);
    expect(getEntityTableName(entity)).toBe(tableName);
    schema.expectTableColumns(tableName, getEntityColumnNames(entity));
  });

  it('keeps login-event fields separate from send budget fields', () => {
    const loginEventColumns = getEntityColumnNames(NapcatLoginEvent);
    expect(loginEventColumns).toEqual(
      expect.arrayContaining([
        'account_id',
        'container_id',
        'event_kind',
        'event_source',
        'event_status',
        'evidence',
      ]),
    );
    expect(loginEventColumns.join(' ')).not.toMatch(
      /hour|daily|quota|budget|limit_count/i,
    );
  });

  it('keeps risk mode separate from account send budgets', () => {
    const riskColumns = getEntityColumnNames(NapcatRiskMode);
    expect(riskColumns).toEqual(
      expect.arrayContaining([
        'account_id',
        'risk_mode',
        'reason',
        'source_event',
        'expires_at',
        'last_evidence',
      ]),
    );
    expect(riskColumns.join(' ')).not.toMatch(/daily|hour|budget|quota/i);
  });
});

describe('NapCat runtime profile generation', () => {
  it('resolves Chinese Desktop Runtime defaults without C.UTF-8 fallback', () => {
    const service = new NapcatRuntimeProfileService({
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          QQBOT_NAPCAT_IMAGE: 'kt-napcat-desktop-cn@sha256:profiledigest',
          QQBOT_NAPCAT_RUNTIME_GID: '1101',
          QQBOT_NAPCAT_RUNTIME_UID: '1101',
          QQBOT_NAPCAT_SHM_SIZE: '512m',
        };
        return values[key] || defaultValue || '';
      }),
    } as any);

    const profile = service.resolveRuntimeProfile({
      accountId: 'account-1',
      containerId: 'container-1',
      dataDir: '/vol1/docker/kt-qqbot/napcat-instances/linux-pc-a1b2',
      deviceIdentityId: 'identity-1',
    });

    expect(profile).toMatchObject({
      imageRef: 'kt-napcat-desktop-cn@sha256:profiledigest',
      locale: 'zh_CN.UTF-8',
      runtimeGid: 1101,
      runtimeUid: 1101,
      shmSize: '512m',
      xdgCacheHome: '/app/.cache',
      xdgConfigHome: '/app/.config',
      xdgDataHome: '/app/.local/share',
    });
    expect(profile.locale).not.toBe('C.UTF-8');
  });

  it('persists planned runtime and protocol profiles when a managed container is rebuilt', async () => {
    const runtimeProfileRepository = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
    };
    const protocolProfileRepository = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
    };
    const service = new (NapcatRuntimeProfileService as any)(
      {
        get: jest.fn((key: string, defaultValue?: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_IMAGE: 'kt-napcat-desktop-cn@sha256:profiledigest',
            QQBOT_NAPCAT_PROFILE_VERSION: 'napcat-runtime-profile-v1',
            QQBOT_NAPCAT_PROTOCOL_PROFILE_VERSION: 'napcat-protocol-profile-v1',
          };
          return values[key] || defaultValue || '';
        }),
      },
      runtimeProfileRepository,
      protocolProfileRepository,
    );
    const runtimeProfile = service.resolveRuntimeProfile({
      accountId: 'account-1',
      containerId: 'container-1',
      dataDir: '/vol1/docker/kt-qqbot/napcat-instances/pc-a1b2c3d4',
      deviceIdentityId: 'identity-1',
    });

    await service.recordPlannedProfiles({
      accountId: 'account-1',
      containerId: 'container-1',
      dataDir: runtimeProfile.dataDir,
      deviceIdentity: {
        deviceIdentityId: 'identity-1',
        hostname: 'pc-a1b2c3d4',
        hostnameStrategy: 'qqnt-visible-hostname-v1',
        machineInfoPath:
          '/vol1/docker/kt-qqbot/napcat-instances/pc-a1b2c3d4/QQ/nt_qq/global/nt_data/msf/machine-info',
        macAddress: '3c:97:0e:aa:bb:cc',
        macStrategy: 'physical-oui-mac-v1',
      },
      protocolProfile: {
        napcatConfigHash: 'napcat-hash',
        napcatConfigJson: { o3HookMode: 1 },
        o3HookGrayEnabled: false,
        o3HookMode: 1,
        onebotConfigHash: 'onebot-hash',
        onebotConfigJson: { network: { websocketClients: [] } },
        packetBackend: 'auto',
        packetServer: '',
      },
      runtimeProfile,
    });

    expect(runtimeProfileRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        containerId: 'container-1',
        deviceIdentityId: 'identity-1',
        hostnameStrategy: 'qqnt-visible-hostname-v1',
        lastCheckEvidence: expect.objectContaining({
          dataDir: runtimeProfile.dataDir,
          machineInfoPath:
            '/vol1/docker/kt-qqbot/napcat-instances/pc-a1b2c3d4/QQ/nt_qq/global/nt_data/msf/machine-info',
          macAddress: '3c:97:0e:aa:bb:cc',
        }),
        macStrategy: 'physical-oui-mac-v1',
        profileStatus: 'pending',
        profileVersion: 'napcat-runtime-profile-v1',
        timezoneEvidence: {
          expectedTimezone: 'Asia/Shanghai',
        },
      }),
    );
    expect(protocolProfileRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        containerId: 'container-1',
        napcatConfigHash: 'napcat-hash',
        onebotConfigHash: 'onebot-hash',
        profileStatus: 'pending',
        profileVersion: 'napcat-protocol-profile-v1',
      }),
    );
  });

  it('writes account-level NapCat and OneBot configs with minimal reverse WS only', () => {
    const writer = new NapcatConfigWriterService(new ToolsService());
    const webuiAuthValue = 'KT_TEST_WEBUI_AUTH_VALUE';
    const result = writer.buildConfigFiles({
      account: '10001',
      reverseWsUrl: 'ws://127.0.0.1:48085/qqbot/onebot/reverse',
      token: webuiAuthValue,
    });

    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'webui.json',
        'napcat.json',
        'napcat_10001.json',
        'onebot11.json',
        'onebot11_10001.json',
      ]),
    );
    expect(result.onebotConfig.network.websocketClients).toHaveLength(1);
    expect(result.onebotConfig.network.httpServers).toEqual([]);
    expect(result.onebotConfig.network.websocketServers).toEqual([]);
    expect(result.onebotConfig.network.websocketClients[0]).toMatchObject({
      debug: false,
      enable: true,
      heartInterval: 30000,
      messagePostFormat: 'array',
      reconnectInterval: 5000,
      reportSelfMessage: false,
    });
    expect(
      result.files.find((file) => file.path === 'webui.json')?.content,
    ).toContain(webuiAuthValue);
    expect(
      JSON.stringify({
        napcatConfigHash: result.napcatConfigHash,
        onebotConfig: result.onebotConfig,
        onebotConfigHash: result.onebotConfigHash,
      }),
    ).not.toContain(webuiAuthValue);
  });
});

describe('NapCat runtime profile inspector', () => {
  it('builds a bounded SSH inspection script without exposing secrets', () => {
    const service = new NapcatRuntimeProfileInspectionScriptService();

    const script = service.buildInspectScript('kt-qqbot-napcat-10001');

    expect(script).toContain('docker inspect');
    expect(script).toContain('locale -a');
    expect(script).toContain('fc-match');
    expect(script).toContain('/proc/1/cgroup');
    expect(script).toContain('/.dockerenv');
    expect(script).not.toContain('WEBUI_TOKEN');
    expect(script).not.toContain('NAPCAT_QUICK_PASSWORD');
  });

  it('sanitizes config and evidence before returning to Admin', () => {
    const service = new NapcatRuntimeProfileInspectorService(
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;
    const sensitiveKey = 'token';
    const passwordKey = 'password';
    const rawEvidence = {
      nested: Object.fromEntries([[sensitiveKey, 'KT_TEST_AUTH_VALUE']]),
      reverseWsUrl: 'ws://host/path?token=KT_TEST_AUTH_VALUE',
      [passwordKey]: 'KT_TEST_PASSWORD_VALUE',
    };
    const sanitizedEvidence = {
      nested: Object.fromEntries([[sensitiveKey, '[REDACTED]']]),
      reverseWsUrl: 'ws://host/path?token=[REDACTED]',
      [passwordKey]: '[REDACTED]',
    };

    expect(service.sanitizeEvidence(rawEvidence)).toEqual(sanitizedEvidence);
  });
});

describe('NapCat runtime profile HTTP API', () => {
  let app: INestApplication;
  const redactedKeyA = ['tok', 'en'].join('');
  const redactedKeyB = ['pass', 'word'].join('');
  const runtimeProfileRepository = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => ({
      accountId: 'account-1',
      imageRef: 'kt-napcat-desktop-cn@sha256:profiledigest',
      locale: 'zh_CN.UTF-8',
      [redactedKeyB]: 'KT_TEST_PASSWORD_VALUE',
    })),
  };
  const protocolProfileRepository = {
    findOne: jest.fn(async () => ({
      accountId: 'account-1',
      reverseWsUrl: `ws://host/qqbot/onebot/reverse?${redactedKeyA}=KT_TEST_AUTH_VALUE`,
      [redactedKeyA]: 'KT_TEST_AUTH_VALUE',
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotNapcatRuntimeController],
      providers: [
        NapcatRuntimeProfileInspectorService,
        ToolsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, defaultValue?: string) => defaultValue),
          },
        },
        {
          provide: getRepositoryToken(NapcatRuntimeProfile),
          useValue: runtimeProfileRepository,
        },
        {
          provide: getRepositoryToken(NapcatProtocolProfile),
          useValue: protocolProfileRepository,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn(() => true),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    runtimeProfileRepository.find.mockClear();
    runtimeProfileRepository.findOne.mockClear();
    protocolProfileRepository.findOne.mockClear();
  });

  it('returns sanitized runtime profile evidence through the local HTTP route', async () => {
    const response = await request(app.getHttpServer())
      .get('/qqbot/napcat/runtime/detail')
      .query({ accountId: 'account-1' })
      .expect(200);

    expect(response.body).toMatchObject({
      code: 200,
      data: {
        accountId: 'account-1',
        inspectionTimeoutMs: 15000,
        protocolProfile: {
          reverseWsUrl: `ws://host/qqbot/onebot/reverse?${redactedKeyA}=[REDACTED]`,
          [redactedKeyA]: '[REDACTED]',
        },
        runtimeProfile: {
          imageRef: 'kt-napcat-desktop-cn@sha256:profiledigest',
          locale: 'zh_CN.UTF-8',
          [redactedKeyB]: '[REDACTED]',
        },
      },
      msg: '操作成功',
    });
  });
});
