import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import {
  AdminLlmConfigEntity,
  AdminLlmConversationEntity,
  AdminLlmMessageEntity,
} from '../../../src/modules/admin/llm/infrastructure/persistence/llm.entities';

describe('LLM persistence and menu contract', () => {
  it('keeps API Key excluded from ordinary selects', () => {
    const columns = getMetadataArgsStorage().columns;
    const secret = columns.find(
      (column) =>
        column.target === AdminLlmConfigEntity &&
        column.propertyName === 'apiKeySecret',
    );
    expect(secret?.options.select).toBe(false);
    expect(secret?.options.type).toBe('text');
    expect(JSON.stringify(new AdminLlmConfigEntity())).not.toContain(
      'apiKeySecret',
    );
  });

  it('registers three exact table names and message uniqueness indexes', () => {
    const tables = getMetadataArgsStorage().tables;
    expect(
      tables.find((table) => table.target === AdminLlmConfigEntity)?.name,
    ).toBe('admin_llm_config');
    expect(
      tables.find((table) => table.target === AdminLlmConversationEntity)?.name,
    ).toBe('admin_llm_conversation');
    expect(
      tables.find((table) => table.target === AdminLlmMessageEntity)?.name,
    ).toBe('admin_llm_message');
    const indexes = getMetadataArgsStorage()
      .indices.filter((index) => index.target === AdminLlmMessageEntity)
      .map((index) => index.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'uk_admin_llm_message_client_id',
        'uk_admin_llm_message_sequence',
      ]),
    );
    const conversationIndexes = getMetadataArgsStorage()
      .indices.filter((index) => index.target === AdminLlmConversationEntity)
      .map((index) => index.name);
    expect(conversationIndexes).toContain(
      'uk_admin_llm_conversation_scene_ref',
    );
    const conversationColumns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === AdminLlmConversationEntity)
      .map((column) => column.propertyName);
    const messageColumns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === AdminLlmMessageEntity)
      .map((column) => column.propertyName);
    expect(conversationColumns).toEqual(
      expect.arrayContaining([
        'scene',
        'sceneRefId',
        'selectedReasoningEffort',
        'selectedServiceTier',
      ]),
    );
    expect(messageColumns).toContain('metadata');
  });

  it('ships idempotent schema, exact menu permissions and independent verify SQL', () => {
    const init = readFileSync(resolve('sql/llm-init.sql'), 'utf8');
    const verify = readFileSync(resolve('sql/llm-verify.sql'), 'utf8');
    for (const table of [
      'admin_llm_config',
      'admin_llm_conversation',
      'admin_llm_message',
    ]) {
      expect(init).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
      expect(verify).toContain(table);
    }
    for (const menuName of [
      'Llm',
      'LlmConfig',
      'LlmChat',
      'LlmConfigCreate',
      'LlmConfigUpdate',
      'LlmConfigDelete',
      'LlmConfigTest',
      'LlmConfigDefault',
      'LlmConfigToggle',
      'LlmChatUse',
    ]) {
      expect(init).toContain(`'${menuName}'`);
      expect(verify).toContain(`'${menuName}'`);
    }
    expect(init).toContain('uk_admin_llm_conversation_scene_ref');
    expect(init).toContain('selected_reasoning_effort');
    expect(init).toContain('selected_service_tier');
    expect(verify).toContain('uk_admin_llm_conversation_scene_ref');
    expect(init).toContain('"fullPathKey":false');
    expect(init).toContain('"keepAlive":true');
    expect(verify).toContain("'llm_chat_keep_alive'");
    expect(verify).toContain("JSON_EXTRACT(meta, '$.keepAlive')");
    expect(init).not.toMatch(/sk-[A-Za-z0-9]|apiKey\s*=/u);
  });
});
