import { getMetadataArgsStorage } from 'typeorm';
import { ToolsService } from '@/common';
import { NapcatConfigWriterService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-config-writer.service';
import { NapcatRuntimeProfileService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service';
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
