import { readFileSync } from 'fs';
import { resolve } from 'path';

const tables = [
  'qqbot_message_subscription',
  'qqbot_message_template',
  'qqbot_message_publish_binding',
  'qqbot_message_publish_target',
  'qqbot_message_event',
  'qqbot_message_delivery',
] as const;

const menuEntries = [
  ['2041700000000100413', 'QqBotMessageSubscription', 'QqBot:MessageSubscription:List'],
  ['2041700000000100414', 'QqBotMessageTemplate', 'QqBot:MessageTemplate:List'],
  ['2041700000000120461', 'QqBotMessageSubscriptionList', 'QqBot:MessageSubscription:List'],
  ['2041700000000120462', 'QqBotMessageSubscriptionCreate', 'QqBot:MessageSubscription:Create'],
  ['2041700000000120463', 'QqBotMessageSubscriptionUpdate', 'QqBot:MessageSubscription:Update'],
  ['2041700000000120464', 'QqBotMessageSubscriptionDelete', 'QqBot:MessageSubscription:Delete'],
  ['2041700000000120465', 'QqBotMessageSubscriptionToggle', 'QqBot:MessageSubscription:Toggle'],
  ['2041700000000120471', 'QqBotMessageTemplateList', 'QqBot:MessageTemplate:List'],
  ['2041700000000120472', 'QqBotMessageTemplateCreate', 'QqBot:MessageTemplate:Create'],
  ['2041700000000120473', 'QqBotMessageTemplateUpdate', 'QqBot:MessageTemplate:Update'],
  ['2041700000000120474', 'QqBotMessageTemplateDelete', 'QqBot:MessageTemplate:Delete'],
  ['2041700000000120475', 'QqBotMessageTemplateToggle', 'QqBot:MessageTemplate:Toggle'],
  ['2041700000000120476', 'QqBotMessageTemplatePreview', 'QqBot:MessageTemplate:Preview'],
  ['2041700000000120481', 'QqBotAccountMessagePushList', 'QqBot:Account:MessagePush:List'],
  ['2041700000000120482', 'QqBotAccountMessagePushCreate', 'QqBot:Account:MessagePush:Create'],
  ['2041700000000120483', 'QqBotAccountMessagePushUpdate', 'QqBot:Account:MessagePush:Update'],
  ['2041700000000120484', 'QqBotAccountMessagePushDelete', 'QqBot:Account:MessagePush:Delete'],
  ['2041700000000120485', 'QqBotAccountMessagePushToggle', 'QqBot:Account:MessagePush:Toggle'],
] as const;

/** Reads SQL with case and quote differences removed for contract assertions. */
const readNormalizedSql = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\s+/g, ' ');

describe('QQBot message-push SQL contract', () => {
  const bootstrapSql = readNormalizedSql('sql/qqbot-init.sql');
  const schemaSql = readNormalizedSql('sql/refactor-v3/00-full-schema.sql');
  const seedSql = readNormalizedSql('sql/refactor-v3/01-seed-core.sql');
  const verifySql = readNormalizedSql('sql/refactor-v3/99-verify.sql');
  const vbenSql = readNormalizedSql('sql/vben-admin-init.sql');

  it.each(tables)('declares %s in current and bootstrap schema SQL', (table) => {
    expect(bootstrapSql).toContain(`create table if not exists ${table}`);
    expect(schemaSql).toContain(`create table if not exists ${table}`);
  });

  it('keeps six-table indexes, datetime precision, and JSON fields aligned', () => {
    for (const sql of [bootstrapSql, schemaSql]) {
      expect(sql).toContain('uk_qqbot_message_subscription_active_key');
      expect(sql).toContain('uk_qqbot_message_publish_binding_active_key');
      expect(sql).toContain('uk_qqbot_message_publish_target_active_key');
      expect(sql).toContain('uk_qqbot_message_event_event_id');
      expect(sql).toContain('uk_qqbot_message_delivery_event_target');
      expect(sql).toContain('idx_qqbot_message_event_dispatch');
      expect(sql).toContain('idx_qqbot_message_event_lease');
      expect(sql).toContain('idx_qqbot_message_delivery_dispatch');
      expect(sql).toContain('idx_qqbot_message_delivery_lease');
      expect(sql).toContain('idx_qqbot_message_delivery_history');
      expect(sql).toContain('source_config json');
      expect(sql).toContain('payload json');
      expect(sql).toContain('variable_snapshot json');
      expect(sql).toContain('datetime(6)');
    }
  });

  it('seeds the default template and every stable menu node idempotently', () => {
    for (const sql of [bootstrapSql, seedSql]) {
      expect(sql).toContain('2041700000000200601');
      expect(sql).toContain('network.stun.mapping-port-changed');
      expect(sql).toContain('当前stun的端口已变更为${{endpoint}}');
      expect(sql).toContain('where not exists');
    }

    for (const [id, name, authCode] of menuEntries) {
      for (const sql of [bootstrapSql, seedSql, vbenSql]) {
        expect(sql).toContain(id);
        expect(sql).toContain(name.toLowerCase());
        expect(sql).toContain(authCode.toLowerCase());
      }
    }
  });

  it('verifies every persisted message-push table and seeded menu contract', () => {
    for (const table of tables) {
      expect(verifySql).toContain(table);
    }
    expect(verifySql).toContain('2041700000000200601');
    expect(verifySql).toContain('qqbot:messagesubscription:list');
    expect(verifySql).toContain('qqbot:account:messagepush:toggle');
  });
});
