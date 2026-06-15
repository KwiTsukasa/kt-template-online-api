import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../..');

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

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
      'loginSession',
      'loginChallenge',
      'runtimeCleanup',
    ].filter((signal) => !loginSource.includes(signal));

    expect(bannedMemorySignals).toEqual([]);
    expect(missingPersistenceSignals).toEqual([]);
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
