import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const canonicalComponent = '/qqbot/send-log/list';
const canonicalPath = '/qqbot/send-log';
const legacyComponent = '/qqbot/sendLog/list';
const legacyPath = '/qqbot/sendLog';
const menuIdentity = '2041700000000100406';
const repoRoot = join(__dirname, '..', '..', '..', '..');

const readSql = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('QQBot send-log menu route contract', () => {
  it('keeps bootstrap seeds aligned with the kebab-case TSX page path', () => {
    const seedSources = [
      readSql('sql/qqbot-init.sql'),
      readSql('sql/refactor-v3/01-seed-core.sql'),
    ];

    for (const sql of seedSources) {
      expect(sql).toContain(
        `'QqBotSendLog', '${canonicalPath}', '${canonicalComponent}', NULL, 'QqBot:SendLog:List'`,
      );
      expect(sql).not.toContain(`'${legacyPath}'`);
      expect(sql).not.toContain(`'${legacyComponent}'`);
    }
  });

  it('provides a narrow idempotent migration for existing menu rows', () => {
    const migration = readSql('sql/qqbot-send-log-menu-route-v1.sql');

    expect(migration).toContain('UPDATE `admin_menu`');
    expect(migration).toContain(`SET \`path\` = '${canonicalPath}'`);
    expect(migration).toContain(`\`component\` = '${canonicalComponent}'`);
    expect(migration).toContain(`WHERE \`id\` = ${menuIdentity}`);
    expect(migration).toContain("AND `name` = 'QqBotSendLog'");
    expect(migration).toContain("AND `auth_code` = 'QqBot:SendLog:List'");
    expect(migration).not.toMatch(/\b(?:DELETE|DROP|TRUNCATE)\b/iu);
  });

  it('ships a read-only verification for the migrated route', () => {
    const verification = readSql('sql/qqbot-send-log-menu-route-v1-verify.sql');

    expect(verification).toContain(`\`id\` = ${menuIdentity}`);
    expect(verification).toContain(`\`path\` = '${canonicalPath}'`);
    expect(verification).toContain(`\`component\` = '${canonicalComponent}'`);
    expect(verification).not.toMatch(
      /\b(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE)\b/iu,
    );
  });
});
