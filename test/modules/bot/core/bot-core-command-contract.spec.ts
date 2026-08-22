import { BOT_CORE_DOMAIN_CONTRACT } from '../../../../src/modules/bot-adapter/core/contract/bot-core.contract';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot core command contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps operation lookup, command ID binding, aliases, cooldown and parser validation explicit', () => {
    expect(BOT_CORE_DOMAIN_CONTRACT.command).toEqual({
      commandTable: 'bot_command',
      commandIdField: 'id',
      commandKeyField: 'command_key',
      operationKeyField: 'operation_key',
      pluginKeyField: 'plugin_key',
      enabledField: 'enabled',
      cooldownField: 'cooldown_seconds',
      aliasTable: 'bot_command_alias',
      aliasCommandField: 'command_id',
      aliasTextField: 'alias_text',
      accountBindingTable: 'bot_capability_binding',
      accountBindingCommandField: 'capability_key',
      parserValidation: {
        route: 'POST /bot/command/test',
        commandIdField: 'commandId',
        fullCommandTextField: 'text',
      },
    });
    expect(BOT_CORE_DOMAIN_CONTRACT.permission).toEqual({
      policyTable: 'bot_permission_policy',
      policyKeyField: 'policy_key',
      scopeFields: ['scope_type', 'scope_value'],
      effectField: 'effect',
      ruleTable: 'bot_rule',
      ruleCommandField: 'command_id',
      matcherField: 'matcher_json',
      actionField: 'action_json',
      enabledField: 'enabled',
    });

    schema.expectTableColumns('bot_command', [
      'id',
      'operation_key',
      'command_key',
      'plugin_key',
      'enabled',
      'cooldown_seconds',
    ]);
    schema.expectTableColumns('bot_command_alias', [
      'id',
      'command_id',
      'alias_text',
    ]);
    schema.expectTableColumns('bot_capability_binding', [
      'id',
      'account_id',
      'capability_key',
      'enabled',
    ]);
    schema.expectTableColumns('bot_permission_policy', [
      'id',
      'policy_key',
      'scope_type',
      'scope_value',
      'effect',
    ]);
    schema.expectTableColumns('bot_rule', [
      'id',
      'rule_key',
      'account_id',
      'command_id',
      'matcher_json',
      'action_json',
      'enabled',
    ]);
  });
});
