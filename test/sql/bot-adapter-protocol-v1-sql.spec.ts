import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(__dirname, '..', '..');
const migration = readFileSync(
  join(projectRoot, 'sql/bot-adapter-protocol-v1.sql'),
  'utf8',
);
const migrationVerify = readFileSync(
  join(projectRoot, 'sql/bot-adapter-protocol-v1-verify.sql'),
  'utf8',
);
const menuMigration = readFileSync(
  join(projectRoot, 'sql/bot-adapter-menu-v1.sql'),
  'utf8',
);
const botInit = readFileSync(join(projectRoot, 'sql/bot-init.sql'), 'utf8');
const fullSchema = readFileSync(
  join(projectRoot, 'sql/refactor-v3/00-full-schema.sql'),
  'utf8',
);
const coreSeed = readFileSync(
  join(projectRoot, 'sql/refactor-v3/01-seed-core.sql'),
  'utf8',
);
const refactorVerify = readFileSync(
  join(projectRoot, 'sql/refactor-v3/99-verify.sql'),
  'utf8',
);

const renamedTables = [
  ['qqbot_account', 'bot_account'],
  ['qqbot_account_ability', 'bot_account_ability'],
  ['qqbot_connection_session', 'bot_connection_session'],
  ['qqbot_capability_binding', 'bot_capability_binding'],
  ['qqbot_permission_policy', 'bot_permission_policy'],
  ['qqbot_allowlist', 'bot_allowlist'],
  ['qqbot_blocklist', 'bot_blocklist'],
  ['qqbot_command', 'bot_command'],
  ['qqbot_command_alias', 'bot_command_alias'],
  ['qqbot_command_log', 'bot_command_log'],
  ['qqbot_config', 'bot_config'],
  ['qqbot_conversation', 'bot_conversation'],
  ['qqbot_dedupe', 'bot_dedupe'],
  ['qqbot_dedupe_event', 'bot_dedupe_event'],
  ['qqbot_message', 'bot_message'],
  ['qqbot_rule', 'bot_rule'],
  ['qqbot_send_log', 'bot_send_log'],
  ['qqbot_send_task', 'bot_send_task'],
  ['qqbot_message_delivery', 'bot_message_delivery'],
  ['qqbot_message_publish_binding', 'bot_message_publish_binding'],
  ['qqbot_message_publish_target', 'bot_message_publish_target'],
  ['qqbot_napcat_webui_gateway_audit', 'napcat_webui_gateway_audit'],
  ['qqbot_plugin', 'plugin'],
  ['qqbot_plugin_version', 'plugin_version'],
  ['qqbot_plugin_installation', 'plugin_installation'],
  ['qqbot_plugin_operation', 'plugin_operation'],
  ['qqbot_plugin_event_handler', 'plugin_event_handler'],
  ['qqbot_plugin_config', 'plugin_config'],
  ['qqbot_plugin_asset', 'plugin_asset'],
  ['qqbot_plugin_runtime_event', 'plugin_runtime_event'],
  ['qqbot_plugin_task', 'plugin_task'],
  ['qqbot_plugin_task_run', 'plugin_task_run'],
] as const;

describe('Bot Adapter protocol v1 SQL', () => {
  it('renames every legacy Bot and Plugin Platform table through the rerunnable merge path', () => {
    for (const [legacyTable, canonicalTable] of renamedTables) {
      expect(migration).toMatch(
        new RegExp(
          "CALL\\s+`kt_migrate_bot_table`\\(\\s*'" +
            legacyTable +
            "',\\s*'" +
            canonicalTable +
            "'",
        ),
      );
      expect(fullSchema).toContain(
        `CREATE TABLE IF NOT EXISTS ${canonicalTable}`,
      );
      expect(fullSchema).not.toContain(
        `CREATE TABLE IF NOT EXISTS ${legacyTable}`,
      );
    }

    expect(migration).not.toContain('START TRANSACTION');
    expect(migration).toContain('INSERT IGNORE INTO `');
    expect(migration).toContain('Bot table merge has key conflicts');
    expect(migration).toContain('Bot table merge has divergent rows');
    expect(migration).toContain('RENAME INDEX');
    expect(migration).toContain('RESIGNAL');
  });

  it('moves only supported official bindings before retiring account identity binding', () => {
    const completenessCheck = migration.indexOf(
      'IF @kt_tencent_binding_missing > 0 THEN',
    );
    const legacyDrop = migration.indexOf(
      'DROP TABLE `qqbot_plugin_account_binding`',
    );

    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS `tencent_bot_plugin_binding`',
    );
    expect(migration).toContain('INNER JOIN `bot_account` AS `account`');
    expect(migration).toContain('INNER JOIN `plugin` AS `plugin`');
    expect(migration).toContain("'official-websocket'");
    expect(migration).toContain("'official-webhook'");
    expect(migration).toContain("`account`.`connection_mode` = 'reverse-ws'");
    expect(migration).toContain("'event_plugin'");
    expect(migration).toContain('@kt_napcat_binding_mismatch');
    expect(migration).toContain(
      'NapCat event plugin binding migration is incomplete',
    );
    expect(migration).toContain('插件平台不再保存 Bot 身份');
    expect(completenessCheck).toBeGreaterThan(-1);
    expect(legacyDrop).toBeGreaterThan(completenessCheck);
    expect(fullSchema).not.toContain(
      'CREATE TABLE IF NOT EXISTS qqbot_plugin_account_binding',
    );
  });

  it('merges conflicting message subscriber identities and removes the qqbot key', () => {
    expect(migration).toContain(
      'CREATE TEMPORARY TABLE `bot_subscription_key_conflict`',
    );
    expect(migration).toContain(
      'INSERT IGNORE INTO `message_subscription_template`',
    );
    expect(migration).toContain(
      'UPDATE `bot_message_publish_binding` AS `binding`',
    );
    expect(migration).toContain("SET `subscriber_key` = 'bot'");
    expect(migration).toContain("SET `active_key` = CONCAT(\n    'bot:'");
    expect(migrationVerify).toContain('legacy_bot_subscription_key_count');
    expect(refactorVerify).toContain('legacy_bot_subscription_key_count');
    expect(migration).toContain("'/bot-adapter/napcat/onebot/reverse'");
    expect(migrationVerify).toContain('legacy_napcat_reverse_ws_path_count');
    expect(refactorVerify).toContain('legacy_napcat_reverse_ws_path_count');
    expect(migration).toContain(
      'MODIFY COLUMN `last_message_id` VARCHAR(255) NULL',
    );
    expect(migration).toContain('MODIFY COLUMN `message_id` VARCHAR(255) NULL');
    expect(migrationVerify).toContain('bot_message_id_width_mismatch_count');
    expect(refactorVerify).toContain('bot_message_id_width_mismatch_count');
    expect(migration).toContain('kt_retire_legacy_message_tables');
    expect(migration).toContain(
      'Legacy message template retirement is incomplete',
    );
    expect(migration).toContain(
      'Legacy message event retirement is incomplete',
    );
    expect(migration).toContain(
      'Legacy message subscription retirement is incomplete',
    );
    expect(migrationVerify).toContain("'qqbot_message_event'");
    expect(migrationVerify).toContain("'qqbot_message_subscription'");
    expect(migrationVerify).toContain("'qqbot_message_template'");
  });

  it('seeds the Bot and independent Plugin Platform menu hierarchy', () => {
    for (const sql of [botInit, coreSeed]) {
      expect(sql).toContain(
        "'BotNapcatConnection', '/bot/napcat', '/bot/account/list'",
      );
      expect(sql).toContain(
        "'BotTencentConnection', '/bot/tencent', '/bot/tencent/list'",
      );
      expect(sql).toContain(
        "'PluginPlatform', '/plugin-platform', NULL, '/plugin-platform/plugins'",
      );
      expect(sql).toContain(
        "'PluginPlatformPlugins', '/plugin-platform/plugins', '/plugin-platform/plugin/list'",
      );
      expect(sql).toContain(
        "'PluginPlatformTasks', '/plugin-platform/tasks', '/plugin-platform/task/list'",
      );
      expect(sql).toContain("'Bot:Account:WebUI'");
      expect(sql).toContain("'Bot:Account:MessagePush:List'");
      expect(sql).toContain("'PluginPlatform:Plugin:List'");
      expect(sql).toContain("'PluginPlatform:Task:Run'");
      expect(sql).toContain("LIKE 'QqBot:%'");
      expect(sql).toContain("LIKE 'Bot:PluginTask:%'");
    }

    expect(migrationVerify).toContain('canonical_menu_mismatch');
    expect(migrationVerify).toContain('legacy_menu_contract_count');
    expect(refactorVerify).toContain('seed_bot_plugin_menu_mismatch');
    expect(refactorVerify).toContain('legacy_bot_menu_contract_count');
    expect(menuMigration).toContain("'BotTencentConnection', '/bot/tencent'");
    expect(menuMigration).toContain("'PluginPlatform', '/plugin-platform'");
    expect(menuMigration).toContain("'Bot:Tencent:MenuSync'");
    expect(menuMigration).toContain("'PluginPlatform:Plugin:Install'");
    expect(menuMigration).toContain("LIKE 'QqBot:%'");
    expect(menuMigration).toContain("LIKE 'Bot:PluginTask:%'");
  });

  it('uses the independent plugin dictionary and current built-in package contract', () => {
    for (const sql of [botInit, coreSeed]) {
      expect(sql).toContain("'PLUGIN_TRIGGER_MODE'");
      expect(sql).toContain("'QQBOT_PLUGIN_TRIGGER_MODE'");
      expect(sql).toContain("'BOT_PLUGIN_TRIGGER_MODE'");
    }

    expect(coreSeed).toContain("'bot.event.receive'");
    expect(coreSeed).toContain("'bot.reply'");
    expect(coreSeed).toContain("'PLUGIN_BILIBILI_CARD_HTTP_TIMEOUT_MS'");
    expect(coreSeed).toContain("'src/modules/plugins/bilibili-card'");
    expect(coreSeed).not.toContain("'src/modules/qqbot/plugins/bilibili-card'");
    expect(migrationVerify).toContain('legacy_plugin_trigger_mode_count');
    expect(refactorVerify).toContain('legacy_plugin_trigger_mode_count');
  });
});
