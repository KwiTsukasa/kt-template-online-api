import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import {
  NapcatLoginChallengeEntity,
  NapcatLoginSession,
  NapcatLoginStateStoreService,
  NapcatRuntimeCleanup,
  NAPCAT_RUNTIME_ENTITIES,
} from '../../../../src/modules/qqbot/napcat';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

const repoRoot = join(__dirname, '../../../..');
const schema = readRefactorV3SqlSchema();

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

type EntityClass = new (...args: never[]) => unknown;

const getEntityTableName = (entity: EntityClass) => {
  return getMetadataArgsStorage().tables.find(
    (table) => table.target === entity,
  )?.name;
};

const getEntityColumnNames = (entity: EntityClass) => {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);
};

const createRepository = <T extends Record<string, any>>() => {
  const rows: T[] = [];
  return {
    create: jest.fn((input: Partial<T>) => ({ ...input }) as T),
    findOne: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      return (
        rows.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) || null
      );
    }),
    rows,
    save: jest.fn(async (input: T) => {
      rows.push(input);
      return input;
    }),
    update: jest.fn(async (where: Record<string, any>, input: Partial<T>) => {
      const row = rows.find((item) =>
        Object.entries(where).every(([key, value]) => item[key] === value),
      );
      if (row) Object.assign(row, input);
      return { affected: row ? 1 : 0 };
    }),
  };
};

describe('NapCat persistent login state contract', () => {
  it('owns the approved third-phase persistence tables', () => {
    const persistenceRoot = join(
      repoRoot,
      'src/modules/qqbot/napcat/infrastructure/persistence',
    );
    const sqlSchema = readSource('sql/refactor-v3/00-full-schema.sql');
    const persistenceFiles = existsSync(persistenceRoot)
      ? readSource(
          'src/modules/qqbot/napcat/infrastructure/persistence/qqbot-account-napcat.entity.ts',
        ) +
        '\n' +
        readSource(
          'src/modules/qqbot/napcat/infrastructure/persistence/qqbot-napcat-container.entity.ts',
        )
      : '';
    const source = `${sqlSchema}\n${persistenceFiles}`;

    const missing = [
      'napcat_container',
      'napcat_device_identity',
      'napcat_account_binding',
      'napcat_login_session',
      'napcat_login_challenge',
      'napcat_runtime_cleanup',
    ].filter((tableName) => !source.includes(tableName));

    expect(missing).toEqual([]);
  });

  it('keeps login truth in persistence rather than in-memory scan sessions', () => {
    const loginSource = readSource(
      'src/modules/qqbot/napcat/application/login/qqbot-napcat-login.service.ts',
    );

    const bannedMemorySignals = ['new Map', 'scanSessions'].filter((signal) =>
      loginSource.includes(signal),
    );
    const missingPersistenceSignals = [
      'loginSessionStore',
      'recordCaptchaChallenge',
      'recordNewDeviceChallenge',
      'recordRuntimeCleanup',
    ].filter((signal) => !loginSource.includes(signal));

    expect(bannedMemorySignals).toEqual([]);
    expect(missingPersistenceSignals).toEqual([]);
  });

  it('maps login session, challenge, and cleanup entities to the v3 SQL schema', () => {
    expect(NAPCAT_RUNTIME_ENTITIES).toEqual(
      expect.arrayContaining([
        NapcatLoginSession,
        NapcatLoginChallengeEntity,
        NapcatRuntimeCleanup,
      ]),
    );

    for (const entity of [
      NapcatLoginSession,
      NapcatLoginChallengeEntity,
      NapcatRuntimeCleanup,
    ]) {
      const tableName = getEntityTableName(entity);
      const columns = getEntityColumnNames(entity);
      expect(tableName).toBeTruthy();
      schema.expectTableColumns(tableName || '', columns);
    }
  });

  it('keeps NapCat runtime tables covered by the v3 verification SQL', () => {
    const verifySql = readSource('sql/refactor-v3/99-verify.sql');
    const requiredSignals = [
      'napcat_container',
      'napcat_device_identity',
      'napcat_account_binding',
      'napcat_login_session',
      'napcat_login_challenge',
      'napcat_runtime_cleanup',
      'uk_napcat_login_session_key',
      'idx_napcat_login_challenge_session',
      'idx_napcat_runtime_cleanup_session',
    ];

    expect(
      requiredSignals.filter((signal) => !verifySql.includes(signal)),
    ).toEqual([]);
  });

  it('persists session snapshots, challenge state, and cleanup blockers', async () => {
    const loginSessionRepository = createRepository<NapcatLoginSession>();
    const loginChallengeRepository =
      createRepository<NapcatLoginChallengeEntity>();
    const runtimeCleanupRepository = createRepository<NapcatRuntimeCleanup>();
    const store = new NapcatLoginStateStoreService(
      loginSessionRepository as any,
      loginChallengeRepository as any,
      runtimeCleanupRepository as any,
    );

    const session = {
      captchaUrl: 'https://captcha.example/proof',
      containerId: 'container-1',
      containerName: 'kt-qqbot-napcat-10001',
      createdAt: 1000,
      errorMessage: '需要验证码',
      expiresAt: Date.now() + 60_000,
      expectedSelfId: '10001',
      id: 'scan-session-1',
      mode: 'refresh',
      passwordMd5: 'md5',
      status: 'pending',
      webuiPort: 6099,
    } as const;

    store.set(session);
    store.recordCaptchaChallenge(session);
    store.recordRuntimeCleanup(session, {
      cleanupType: 'password-login-env',
      errorMessage: '运行态清理失败',
      status: 'failed',
    });

    await store.flushSessionWrites('scan-session-1');
    await Promise.resolve();

    expect(loginSessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        loginStage: 'captcha',
        sessionKey: 'scan-session-1',
        sessionPayload: session,
        status: 'pending',
      }),
    );
    expect(loginChallengeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeType: 'captcha',
        challengeUrl: 'https://captcha.example/proof',
        sessionId: 'scan-session-1',
        status: 'pending',
      }),
    );
    expect(runtimeCleanupRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupType: 'password-login-env',
        errorMessage: '运行态清理失败',
        sessionId: 'scan-session-1',
        status: 'failed',
      }),
    );
  });

  it('keeps captcha and new-device challenges recoverable and separate', () => {
    const stateMachine = readSource(
      'src/modules/qqbot/napcat/domain/login/napcat-login-state-machine.ts',
    );

    expect(stateMachine).toEqual(expect.stringContaining("type: 'captcha'"));
    expect(stateMachine).toEqual(expect.stringContaining("type: 'new-device'"));
    expect(stateMachine).toEqual(expect.stringContaining('qr-pending'));
    expect(stateMachine).toEqual(expect.stringContaining('scanned'));
    expect(stateMachine).toEqual(expect.stringContaining('confirming'));
    expect(stateMachine).toEqual(expect.stringContaining('cleanup-failed'));
  });
});
