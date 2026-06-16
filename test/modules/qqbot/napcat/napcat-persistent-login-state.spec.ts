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

const getEntityColumnOptions = (entity: EntityClass, propertyName: string) => {
  return getMetadataArgsStorage().columns.find(
    (column) => column.target === entity && column.propertyName === propertyName,
  )?.options;
};

const getSchemaColumnDefinition = (tableName: string, columnName: string) => {
  return schema
    .getTableColumns(tableName)
    .find((column) => column.name === columnName)?.definition;
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
          'src/modules/qqbot/napcat/infrastructure/persistence/napcat-account-binding.entity.ts',
        ) +
        '\n' +
        readSource(
          'src/modules/qqbot/napcat/infrastructure/persistence/napcat-container.entity.ts',
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

  it('stores challenge and cleanup session ids as uuid-safe text', () => {
    expect(
      getEntityColumnOptions(NapcatLoginChallengeEntity, 'sessionId'),
    ).toMatchObject({ length: 64, type: 'varchar' });
    expect(getEntityColumnOptions(NapcatRuntimeCleanup, 'sessionId')).toMatchObject(
      { length: 64, type: 'varchar' },
    );

    expect(
      getSchemaColumnDefinition('napcat_login_challenge', 'session_id'),
    ).toMatch(/^session_id VARCHAR\(64\) NOT NULL/i);
    expect(
      getSchemaColumnDefinition('napcat_runtime_cleanup', 'session_id'),
    ).toMatch(/^session_id VARCHAR\(64\) NOT NULL/i);

    const qqbotInitSql = readSource('sql/qqbot-init.sql');
    expect(qqbotInitSql).toContain('`session_id` varchar(64) NOT NULL');
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

  it('recovers captcha, new-device, and cleanup blockers after cache miss', async () => {
    const loginSessionRepository = createRepository<NapcatLoginSession>();
    const loginChallengeRepository =
      createRepository<NapcatLoginChallengeEntity>();
    const runtimeCleanupRepository = createRepository<NapcatRuntimeCleanup>();
    const store = new NapcatLoginStateStoreService(
      loginSessionRepository as any,
      loginChallengeRepository as any,
      runtimeCleanupRepository as any,
    );

    loginSessionRepository.rows.push({
      expiresAt: new Date(Date.now() + 60_000),
      sessionKey: 'captcha-recover',
      sessionPayload: {
        containerId: 'container-captcha',
        containerName: 'kt-qqbot-napcat-captcha',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        id: 'captcha-recover',
        mode: 'refresh',
        passwordMd5: 'md5',
        status: 'pending',
        webuiPort: 6099,
      },
      status: 'pending',
    } as any);
    loginChallengeRepository.rows.push({
      challengePayload: { expectedSelfId: '10001' },
      challengeType: 'captcha',
      challengeUrl: 'https://captcha.example/proof',
      sessionId: 'captcha-recover',
      status: 'pending',
    } as any);

    loginSessionRepository.rows.push({
      expiresAt: new Date(Date.now() + 60_000),
      sessionKey: 'new-device-recover',
      sessionPayload: {
        containerId: 'container-device',
        containerName: 'kt-qqbot-napcat-device',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        id: 'new-device-recover',
        mode: 'refresh',
        status: 'pending',
        webuiPort: 6099,
      },
      status: 'pending',
    } as any);
    loginChallengeRepository.rows.push({
      challengePayload: {
        deviceVerifyUrl: 'https://ti.qq.com/new-device/verify',
        newDevicePullQrCodeSig: 'sig-new-device',
        newDeviceQrcode: 'data:image/png;base64,new-device-qrcode',
      },
      challengeType: 'new-device',
      challengeUrl: 'data:image/png;base64,new-device-qrcode',
      sessionId: 'new-device-recover',
      status: 'qr-pending',
    } as any);

    loginSessionRepository.rows.push({
      expiresAt: new Date(Date.now() + 60_000),
      sessionKey: 'cleanup-recover',
      sessionPayload: {
        containerId: 'container-cleanup',
        containerName: 'kt-qqbot-napcat-cleanup',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        id: 'cleanup-recover',
        mode: 'refresh',
        passwordMd5: 'md5',
        status: 'pending',
        webuiPort: 6099,
      },
      status: 'pending',
    } as any);
    runtimeCleanupRepository.rows.push({
      cleanupType: 'password-login-env',
      errorMessage: '运行态密码清理失败',
      sessionId: 'cleanup-recover',
      status: 'failed',
    } as any);

    await expect(store.get('captcha-recover')).resolves.toEqual(
      expect.objectContaining({
        captchaUrl: 'https://captcha.example/proof',
        expectedSelfId: '10001',
        id: 'captcha-recover',
        status: 'pending',
      }),
    );
    await expect(store.get('new-device-recover')).resolves.toEqual(
      expect.objectContaining({
        deviceVerifyUrl: 'https://ti.qq.com/new-device/verify',
        newDevicePullQrCodeSig: 'sig-new-device',
        newDeviceQrcode: 'data:image/png;base64,new-device-qrcode',
        newDeviceStatus: 'qr-pending',
      }),
    );
    await expect(store.get('cleanup-recover')).resolves.toEqual(
      expect.objectContaining({
        errorMessage: '运行态密码清理失败',
        passwordMd5: undefined,
        status: 'error',
      }),
    );
  });

  it('does not recover resolved new-device challenges as actionable QR state', async () => {
    const loginSessionRepository = createRepository<NapcatLoginSession>();
    const loginChallengeRepository =
      createRepository<NapcatLoginChallengeEntity>();
    const store = new NapcatLoginStateStoreService(
      loginSessionRepository as any,
      loginChallengeRepository as any,
    );

    loginSessionRepository.rows.push({
      expiresAt: new Date(Date.now() + 60_000),
      sessionKey: 'new-device-failed',
      sessionPayload: {
        containerId: 'container-device',
        containerName: 'kt-qqbot-napcat-device',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        id: 'new-device-failed',
        mode: 'refresh',
        status: 'pending',
        webuiPort: 6099,
      },
      status: 'pending',
    } as any);
    loginChallengeRepository.rows.push({
      challengePayload: {
        deviceVerifyUrl: 'https://ti.qq.com/new-device/verify',
        newDevicePullQrCodeSig: 'stale-sig',
        newDeviceQrcode: 'data:image/png;base64,stale-qrcode',
      },
      challengeType: 'new-device',
      challengeUrl: 'data:image/png;base64,stale-qrcode',
      sessionId: 'new-device-failed',
      status: 'failed',
    } as any);

    const recovered = await store.get('new-device-failed');

    expect(recovered).toEqual(
      expect.objectContaining({
        id: 'new-device-failed',
        status: 'pending',
      }),
    );
    expect(recovered?.deviceVerifyUrl).toBeUndefined();
    expect(recovered?.newDevicePullQrCodeSig).toBeUndefined();
    expect(recovered?.newDeviceQrcode).toBeUndefined();
    expect(recovered?.newDeviceStatus).toBeUndefined();
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
