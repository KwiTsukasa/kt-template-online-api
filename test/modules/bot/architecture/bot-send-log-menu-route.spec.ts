import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const canonicalComponent = '/bot/send-log/list';
const canonicalPath = '/bot/send-log';
const legacyComponent = '/bot/sendLog/list';
const legacyPath = '/bot/sendLog';
const menuIdentity = '2041700000000100406';
const repoRoot = join(__dirname, '..', '..', '..', '..');

const readSql = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('Bot send-log menu route contract', () => {
  it('keeps bootstrap seeds aligned with the kebab-case TSX page path', () => {
    const seedSources = [
      readSql('sql/bot-init.sql'),
      readSql('sql/refactor-v3/01-seed-core.sql'),
    ];

    for (const sql of seedSources) {
      expect(sql).toContain(
        `'BotSendLog', '${canonicalPath}', '${canonicalComponent}', NULL, 'Bot:SendLog:List'`,
      );
      expect(sql).not.toContain(`'${legacyPath}'`);
      expect(sql).not.toContain(`'${legacyComponent}'`);
    }
  });

  it('provides a narrow idempotent migration for existing menu rows', () => {
    const migration = readSql('sql/bot-send-log-menu-route-v1.sql');

    expect(migration).toContain('UPDATE `admin_menu`');
    expect(migration).toContain(`\`path\` = '${canonicalPath}'`);
    expect(migration).toContain("SET `name` = 'BotSendLog'");
    expect(migration).toContain(`\`component\` = '${canonicalComponent}'`);
    expect(migration).toContain("`auth_code` = 'Bot:SendLog:List'");
    expect(migration).toContain(`WHERE \`id\` = ${menuIdentity}`);
    expect(migration).toContain("AND `name` IN ('QqBotSendLog', 'BotSendLog')");
    expect(migration).not.toMatch(/\b(?:DELETE|DROP|TRUNCATE)\b/iu);
  });

  it('ships a read-only verification for the migrated route', () => {
    const verification = readSql('sql/bot-send-log-menu-route-v1-verify.sql');

    expect(verification).toContain(`\`id\` = ${menuIdentity}`);
    expect(verification).toContain(`\`path\` = '${canonicalPath}'`);
    expect(verification).toContain(`\`component\` = '${canonicalComponent}'`);
    expect(verification).not.toMatch(
      /\b(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE)\b/iu,
    );
  });
});
