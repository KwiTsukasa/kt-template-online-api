import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

const retiredLegacyImportTables = [
  'wordpress_site',
  'wordpress_auth_session',
  'wordpress_remote_post',
  'wordpress_remote_term',
  'wordpress_sync_job',
  'wordpress_sync_mapping',
  'blog_import_job',
];

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
    expect(seed).toContain('INSERT INTO bot_command');
    expect(seed).toContain('INSERT INTO plugin');
    expect(verify).toContain('admin_user');
    expect(verify).toContain('bot_command');
    expect(verify).toContain('plugin');
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

  it('keeps retired legacy import tables out of new-install references', () => {
    const referenceFiles = [
      'sql/refactor-v3/00-full-schema.sql',
      'sql/refactor-v3/01-seed-core.sql',
      'sql/refactor-v3/99-verify.sql',
    ];
    const referenceSql = referenceFiles.map((file) =>
      readFileSync(join(root, file), 'utf8'),
    );
    const schemaMap = readFileSync(
      join(root, 'docs/refactor-v3/schema-map.md'),
      'utf8',
    );

    for (const table of retiredLegacyImportTables) {
      referenceSql.forEach((sql) => {
        expect(sql).not.toMatch(
          new RegExp(
            `(?:CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+)?\`?${table}\`?\\b`,
            'i',
          ),
        );
      });
      expect(schemaMap).not.toContain(`\`${table}\``);
    }
  });

  it('does not add destructive table retirement SQL', () => {
    const referenceFiles = [
      'sql/blog-menu.sql',
      'sql/refactor-v3/00-full-schema.sql',
      'sql/refactor-v3/01-seed-core.sql',
      'sql/refactor-v3/99-verify.sql',
      'sql/vben-admin-init.sql',
    ];
    const sqlFiles = referenceFiles.map((file) =>
      readFileSync(join(root, file), 'utf8'),
    );
    sqlFiles.forEach((sql) => {
      expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    });
  });

  it('seeds Bot command rows with required command code and manifest-owned aliases', () => {
    const seed = readFileSync(
      join(root, 'sql/refactor-v3/01-seed-core.sql'),
      'utf8',
    );
    const commandColumns = seed.match(
      /INSERT INTO bot_command \(([\s\S]*?)\) VALUES/,
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

  it('seeds Bot and Plugin Platform menus required by current pages', () => {
    const seed = readFileSync(
      join(root, 'sql/refactor-v3/01-seed-core.sql'),
      'utf8',
    );
    const requiredNames = [
      'Bot',
      'BotDashboard',
      'BotNapcatConnection',
      'BotNapcatConfig',
      'BotNapcatWebui',
      'BotTencentConnection',
      'BotTencentCreate',
      'BotTencentDelete',
      'BotTencentEdit',
      'BotTencentMenuSync',
      'BotTencentPlugin',
      'BotTencentReconnect',
      'BotTencentWebhookUrl',
      'BotAccountConfigButton',
      'BotAccountCreate',
      'BotAccountDelete',
      'BotAccountEdit',
      'BotAccountKick',
      'BotAccountRefreshLogin',
      'BotRule',
      'BotRuleCreate',
      'BotRuleDelete',
      'BotRuleEdit',
      'BotRuleToggle',
      'BotCommand',
      'BotCommandCreate',
      'BotCommandDelete',
      'BotCommandEdit',
      'BotCommandTest',
      'BotCommandToggle',
      'BotConversation',
      'BotMessage',
      'BotSendLog',
      'BotSendPrivate',
      'BotSendGroup',
      'BotPermission',
      'BotPermissionCreate',
      'BotPermissionDelete',
      'BotPermissionEdit',
      'PluginPlatform',
      'PluginPlatformPluginConfig',
      'PluginPlatformPluginDisable',
      'PluginPlatformPluginEnable',
      'PluginPlatformPluginInstall',
      'PluginPlatformPluginUninstall',
      'PluginPlatformPluginUpgrade',
      'PluginPlatformPlugins',
      'PluginPlatformTasks',
      'PluginPlatformTaskUpdateCron',
      'PluginPlatformTaskEnable',
      'PluginPlatformTaskDisable',
      'PluginPlatformTaskRun',
      'PluginPlatformTaskRunLog',
    ];

    for (const name of requiredNames) {
      expect(seed).toContain(`'${name}'`);
    }

    expect(seed).toContain("'Bot:Account:RefreshLogin'");
    expect(seed).toContain("'Bot:Command:Test'");
    expect(seed).toContain("'PluginPlatform:Plugin:List'");
    expect(seed).toContain("'PluginPlatform:Task:Run'");
    expect(seed).toContain("'/bot/napcat'");
    expect(seed).toContain("'/bot/tencent'");
    expect(seed).toContain("'/plugin-platform/plugins'");
    expect(seed).toContain("'/plugin-platform/tasks'");
    expect(seed).toContain('INSERT IGNORE INTO admin_role_menu');
  });

  it('runs dry-run SQL sources with utf8mb4 and bounded native mysql errors', () => {
    const dryRunScript = readFileSync(
      join(root, 'scripts/refactor-v3/db-dry-run.sh'),
      'utf8',
    );

    expect(dryRunScript).toContain('set -Eeuo pipefail');
    expect(dryRunScript).toContain('--default-character-set=utf8mb4');
    expect(dryRunScript).toContain('timeout --foreground');
    expect(dryRunScript).toContain('if [[ $execute != true ]]');
  });

  it('uses the Nest listen port as the local smoke default base URL', () => {
    const localSmokeScript = readFileSync(
      join(root, 'scripts/refactor-v3/local-smoke.sh'),
      'utf8',
    );
    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');

    expect(main).toContain('app.listen(48085)');
    expect(localSmokeScript).toContain('http://127.0.0.1:48085');
  });
});
