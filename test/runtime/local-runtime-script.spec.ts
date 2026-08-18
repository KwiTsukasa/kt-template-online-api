import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('local runtime scripts', () => {
  const projectRoot = process.cwd();
  const packageJson = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8'),
  );
  const shellScript = readFileSync(
    join(projectRoot, 'scripts/local-runtime.sh'),
    'utf8',
  );
  const databaseScript = readFileSync(
    join(projectRoot, 'scripts/local-runtime-database.mjs'),
    'utf8',
  );

  it('exposes direct local start and real verification package commands', () => {
    expect(packageJson.scripts).toMatchObject({
      'start:local': 'bash scripts/local-runtime.sh start',
      'start:local:dev': 'bash scripts/local-runtime.sh dev',
      'verify:local': 'bash scripts/local-runtime.sh verify',
    });
  });

  it('rejects a business database name before probing or mutating dependencies', () => {
    const result = spawnSync('bash', ['scripts/local-runtime.sh', 'verify'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        KT_LOCAL_DB_DATABASE: 'kt_template',
      },
      timeout: 5_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'KT_LOCAL_DB_DATABASE 必须匹配 kt_template_local 或 kt_template_local_*',
    );
    expect(result.stdout).not.toContain('Redis 未监听');
  });

  it('rebuilds only the isolated database and loads every startup schema baseline', () => {
    expect(shellScript).toContain(
      '[[ $db_database =~ ^kt_template_local(_[a-z0-9_]+)?$ ]]',
    );
    expect(databaseScript).toContain('DROP DATABASE IF EXISTS');
    expect(databaseScript).toContain("'00-full-schema.sql'");
    expect(databaseScript).toContain("'01-seed-core.sql'");
    expect(databaseScript).toContain("'media-governance-init.sql'");
    expect(databaseScript).toContain("'system-notice-menu.sql'");
    expect(databaseScript).toContain('messageCenterPermissionCount !== 3');
    expect(shellScript).toContain(
      'KT_LOCAL_ADMIN_PASSWORD=${KT_LOCAL_ADMIN_PASSWORD:-123456}',
    );
    expect(databaseScript).not.toContain('.env.development');
  });
});
