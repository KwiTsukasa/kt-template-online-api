import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

/**
 * 执行 测试断言流程。
 */
const extractSchemaMapTables = () => {
  const schemaMap = readFileSync(
    join(root, 'docs/refactor-v3/schema-map.md'),
    'utf8',
  );

  const matches = schemaMap.match(/`[a-z][a-z0-9_]+`/g) || [];

  return Array.from(
    new Set(
      matches
        .map((match) => match.slice(1, -1))
        .filter((tableName) => !tableName.endsWith('_*')),
    ),
  ).sort();
};

describe('refactor v3 schema skeleton', () => {
  it('declares every table listed in the schema map in the full schema file', () => {
    const sql = readFileSync(
      join(root, 'sql/refactor-v3/00-full-schema.sql'),
      'utf8',
    );
    const requiredTables = extractSchemaMapTables();

    expect(requiredTables.length).toBeGreaterThan(50);

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('declares core seed and verification scripts', () => {
    const seed = readFileSync(
      join(root, 'sql/refactor-v3/01-seed-core.sql'),
      'utf8',
    );
    const verify = readFileSync(
      join(root, 'sql/refactor-v3/99-verify.sql'),
      'utf8',
    );

    expect(seed).toContain('INSERT INTO admin_user');
    expect(seed).toContain('INSERT INTO qqbot_command');
    expect(seed).toContain('INSERT INTO qqbot_plugin');
    expect(verify).toContain('admin_user');
    expect(verify).toContain('qqbot_command');
    expect(verify).toContain('qqbot_plugin');
    expect(verify).toContain('napcat_device_identity');
  });

  it('declares bootstrap tables required before the API can finish startup', () => {
    const sql = readFileSync(
      join(root, 'sql/refactor-v3/00-full-schema.sql'),
      'utf8',
    );
    const verify = readFileSync(
      join(root, 'sql/refactor-v3/99-verify.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_dict');
    expect(verify).toContain('admin_dict');
  });

  it('declares blog tables compatible with current runtime entities', () => {
    const sql = readFileSync(
      join(root, 'sql/refactor-v3/00-full-schema.sql'),
      'utf8',
    );
    const blogTermColumns = sql.match(
      /CREATE TABLE IF NOT EXISTS blog_term \(([\s\S]*?)\) ENGINE=/,
    )?.[1];

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS blog_article');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS blog_theme_config');
    expect(sql).toContain('content_markdown');
    expect(sql).toContain('content_html');
    expect(sql).toContain('category_items');
    expect(sql).toContain('tag_items');
    expect(sql).toContain('author_name');
    expect(sql).toContain('publish_time');
    expect(sql).toContain('is_deleted');
    expect(blogTermColumns).toContain('kind');
    expect(blogTermColumns).toContain('name');
    expect(blogTermColumns).toContain('description');
    expect(blogTermColumns).toContain('parent_id');
  });

  it('seeds qqbot command rows with required command code and manifest-owned aliases', () => {
    const seed = readFileSync(
      join(root, 'sql/refactor-v3/01-seed-core.sql'),
      'utf8',
    );
    const commandColumns = seed.match(
      /INSERT INTO qqbot_command \(([\s\S]*?)\) VALUES/,
    )?.[1];

    expect(commandColumns).toContain('code');
    expect(commandColumns).toContain('aliases');
    expect(seed).toContain("'bangdream.song.search'");
    expect(seed).toContain("'bd'");
    expect(seed).toContain("'[]'");
    expect(seed).not.toContain(
      '["查曲","bd","bangdream","bandori","邦邦","邦邦查歌"]',
    );
  });

  it('seeds qqbot admin menus and button permissions required by current pages', () => {
    const seed = readFileSync(
      join(root, 'sql/refactor-v3/01-seed-core.sql'),
      'utf8',
    );
    const requiredNames = [
      'QqBotDashboard',
      'QqBotAccount',
      'QqBotAccountConfig',
      'QqBotAccountConfigButton',
      'QqBotAccountCreate',
      'QqBotAccountDelete',
      'QqBotAccountEdit',
      'QqBotAccountKick',
      'QqBotAccountRefreshLogin',
      'QqBotRule',
      'QqBotRuleCreate',
      'QqBotRuleDelete',
      'QqBotRuleEdit',
      'QqBotRuleToggle',
      'QqBotCommand',
      'QqBotCommandCreate',
      'QqBotCommandDelete',
      'QqBotCommandEdit',
      'QqBotCommandTest',
      'QqBotCommandToggle',
      'QqBotPlugin',
      'QqBotConversation',
      'QqBotMessage',
      'QqBotSendLog',
      'QqBotSendPrivate',
      'QqBotSendGroup',
      'QqBotPermission',
      'QqBotPermissionCreate',
      'QqBotPermissionDelete',
      'QqBotPermissionEdit',
    ];

    for (const name of requiredNames) {
      expect(seed).toContain(`'${name}'`);
    }

    expect(seed).toContain("'QqBot:Account:RefreshLogin'");
    expect(seed).toContain("'QqBot:Command:Test'");
    expect(seed).toContain('INSERT IGNORE INTO admin_role_menu');
  });

  it('runs dry-run SQL sources with utf8mb4 and fails on native mysql errors', () => {
    const dryRunScript = readFileSync(
      join(root, 'scripts/refactor-v3/db-dry-run.ps1'),
      'utf8',
    );

    expect(dryRunScript).toContain('--default-character-set=utf8mb4');
    expect(dryRunScript).toContain('$LASTEXITCODE');
    expect(dryRunScript).toContain('throw');
  });

  it('uses the Nest listen port as the local smoke default base URL', () => {
    const localSmokeScript = readFileSync(
      join(root, 'scripts/refactor-v3/local-smoke.ps1'),
      'utf8',
    );
    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');

    expect(main).toContain('app.listen(48085)');
    expect(localSmokeScript).toContain('http://127.0.0.1:48085');
  });
});
