jest.mock('@/qqbot/qqbot.module', () => ({
  QqbotModule: class QqbotModule {},
}));
jest.mock('@/qqbot/plugin/qqbot-event-plugin-registry.service', () => ({
  QqbotEventPluginRegistryService: class QqbotEventPluginRegistryService {},
}));
jest.mock(
  '../../../../src/qqbot/plugin/qqbot-event-plugin-registry.service',
  () => ({
    QqbotEventPluginRegistryService: class QqbotEventPluginRegistryService {},
  }),
);
jest.mock('@/qqbot/plugin/qqbot-plugin-registry.service', () => ({
  QqbotPluginRegistryService: class QqbotPluginRegistryService {},
}));
jest.mock('../../../../src/qqbot/plugin/qqbot-plugin-registry.service', () => ({
  QqbotPluginRegistryService: class QqbotPluginRegistryService {},
}));

import { QQBOT_CORE_DOMAIN_CONTRACT } from '../../../../src/modules/qqbot/core/qqbot-core.contract';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot core command contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps operation lookup, command ID binding, aliases, cooldown and parser validation explicit', () => {
    expect(QQBOT_CORE_DOMAIN_CONTRACT.command).toEqual({
      commandTable: 'qqbot_command',
      commandIdField: 'id',
      commandKeyField: 'command_key',
      operationKeyField: 'operation_key',
      pluginKeyField: 'plugin_key',
      enabledField: 'enabled',
      cooldownField: 'cooldown_seconds',
      aliasTable: 'qqbot_command_alias',
      aliasCommandField: 'command_id',
      aliasTextField: 'alias_text',
      accountBindingTable: 'qqbot_capability_binding',
      accountBindingCommandField: 'capability_key',
      parserValidation: {
        route: 'POST /qqbot/command/test',
        commandIdField: 'commandId',
        fullCommandTextField: 'text',
      },
    });
    expect(QQBOT_CORE_DOMAIN_CONTRACT.permission).toEqual({
      policyTable: 'qqbot_permission_policy',
      policyKeyField: 'policy_key',
      scopeFields: ['scope_type', 'scope_value'],
      effectField: 'effect',
      ruleTable: 'qqbot_rule',
      ruleCommandField: 'command_id',
      matcherField: 'matcher_json',
      actionField: 'action_json',
      enabledField: 'enabled',
    });

    schema.expectTableColumns('qqbot_command', [
      'id',
      'operation_key',
      'command_key',
      'plugin_key',
      'enabled',
      'cooldown_seconds',
    ]);
    schema.expectTableColumns('qqbot_command_alias', [
      'id',
      'command_id',
      'alias_text',
    ]);
    schema.expectTableColumns('qqbot_capability_binding', [
      'id',
      'account_id',
      'capability_key',
      'enabled',
    ]);
    schema.expectTableColumns('qqbot_permission_policy', [
      'id',
      'policy_key',
      'scope_type',
      'scope_value',
      'effect',
    ]);
    schema.expectTableColumns('qqbot_rule', [
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
