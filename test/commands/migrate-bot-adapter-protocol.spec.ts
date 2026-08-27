import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertBotAdapterMigrationVerification,
  parseMysqlScript,
} from '../../src/commands/migrate-bot-adapter-protocol';

describe('Bot Adapter protocol migration command', () => {
  it('keeps each stored procedure body intact while removing MySQL delimiter directives', () => {
    const source = readFileSync(
      resolve('sql/bot-adapter-protocol-v1.sql'),
      'utf8',
    );
    const statements = parseMysqlScript(source);
    const tableMigrationProcedure = statements.find((statement) =>
      statement.includes('CREATE PROCEDURE `kt_migrate_bot_table`'),
    );

    expect(statements.length).toBeGreaterThan(10);
    expect(
      statements.some((statement) => /\bDELIMITER\b/iu.test(statement)),
    ).toBe(false);
    expect(tableMigrationProcedure).toContain("SIGNAL SQLSTATE '45000'");
    expect(tableMigrationProcedure).toContain('DEALLOCATE PREPARE kt_bot_stmt');
  });

  it('accepts only the complete frozen verification matrix', () => {
    const valid = {
      canonical_menu_mismatch: 0,
      canonical_menu_role_mismatch: 0,
      canonical_table_count: 33,
      legacy_bot_subscription_key_count: 0,
      legacy_napcat_reverse_ws_path_count: 0,
      bot_message_id_width_mismatch_count: 0,
      legacy_index_name_count: 0,
      legacy_menu_contract_count: 0,
      legacy_plugin_trigger_mode_count: 0,
      legacy_table_count: 0,
      natmap_command_conflict_count: 0,
      natmap_command_duplicate_count: 0,
      natmap_command_identity_count: 1,
      plugin_trigger_mode_mismatch: 0,
      plugin_trigger_mode_missing_count: 0,
      tencent_binding_missing_account_count: 0,
      tencent_binding_missing_plugin_count: 0,
    };

    expect(assertBotAdapterMigrationVerification(valid)).toEqual(valid);
    expect(() =>
      assertBotAdapterMigrationVerification({
        ...valid,
        legacy_table_count: 1,
      }),
    ).toThrow('legacy_table_count=1');
    const incomplete: Record<string, number> = { ...valid };
    delete incomplete.canonical_menu_mismatch;
    expect(() => assertBotAdapterMigrationVerification(incomplete)).toThrow(
      'canonical_menu_mismatch',
    );
  });
});
