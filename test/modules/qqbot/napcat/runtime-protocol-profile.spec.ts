import { getMetadataArgsStorage } from 'typeorm';
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
