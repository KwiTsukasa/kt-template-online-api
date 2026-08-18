import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schemaFiles = [
  'sql/qqbot-message-push-init.sql',
  'sql/qqbot-init.sql',
  'sql/refactor-v3/00-full-schema.sql',
] as const;

const menuSeedFiles = [
  'sql/qqbot-message-push-init.sql',
  'sql/qqbot-init.sql',
  'sql/vben-admin-init.sql',
  'sql/refactor-v3/01-seed-core.sql',
] as const;

/**
 * 读取 SQL 文件并折叠标识符引号、大小写和空白，便于比较结构契约。
 *
 * @param relativePath - 相对于 API 仓库根目录的 SQL 文件路径。
 * @returns 保留字符串内容但统一结构空白与标识符格式的 SQL 文本。
 */
function readNormalizedSql(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
    .replaceAll('`', '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 从规范化 SQL 中提取指定建表语句的完整字段和索引定义。
 *
 * @param sql - 已规范化的 SQL 文本。
 * @param tableName - 要提取的数据库表名。
 * @returns 从 CREATE TABLE 开始到引擎声明结束的建表片段。
 */
function extractTableBlock(sql: string, tableName: string): string {
  const start = `create table if not exists ${tableName} (`;
  const startIndex = sql.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endMarker =
    ') engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;';
  const endIndex = sql.indexOf(endMarker, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sql.slice(startIndex, endIndex + endMarker.length);
}

describe('message management SQL contract', () => {
  it.each(schemaFiles)(
    '%s models a multi-template subscription and concrete subscriber adapters',
    (relativePath) => {
      const sql = readNormalizedSql(relativePath);
      const subscription = extractTableBlock(sql, 'message_subscription');
      const templateBinding = extractTableBlock(
        sql,
        'message_subscription_template',
      );
      const qqbotBinding = extractTableBlock(
        sql,
        'qqbot_message_publish_binding',
      );
      const delivery = extractTableBlock(sql, 'qqbot_message_delivery');
      const stationNotice = extractTableBlock(
        sql,
        'station_notice_message_binding',
      );

      expect(subscription).toContain('subscriber_key varchar(64) not null');
      expect(subscription).toContain(
        'template_binding_digest char(64) not null',
      );
      expect(subscription).toContain('source_config json not null');
      expect(subscription).not.toContain('source_key varchar');
      expect(templateBinding).toContain(
        'primary key (subscription_id, template_id)',
      );
      expect(templateBinding).toContain(
        'unique key uk_message_subscription_template_order (subscription_id, sort_order)',
      );
      expect(qqbotBinding).toContain('subscription_id bigint not null');
      expect(qqbotBinding).not.toContain('template_id');
      expect(delivery).toContain(
        'unique key uk_qqbot_message_delivery_event_target_template (message_event_id, publish_target_id, template_id)',
      );
      expect(stationNotice).toContain('subscription_id bigint not null');
      expect(stationNotice).toContain('notify_role_code varchar(64) not null');
    },
  );

  it('migrates legacy QQBot protocol records before dropping private template ownership', () => {
    const sql = readNormalizedSql('sql/qqbot-message-push-init.sql');

    expect(sql).toContain('from qqbot_message_template');
    expect(sql).toContain('from qqbot_message_event');
    expect(sql).toContain('from qqbot_message_subscription legacy');
    expect(sql).toContain(
      'create temporary table legacy_message_subscription_template_map',
    );
    expect(sql).toContain(
      'when ranked.template_rank = 1 then ranked.subscription_id else ranked.seed_binding_id',
    );
    expect(sql).toContain(
      'insert ignore into message_subscription_template (subscription_id, template_id, sort_order)',
    );
    expect(sql).toContain(
      'set delivery.subscription_id = mapping.mapped_subscription_id',
    );
    expect(sql).toContain(
      'binding.subscription_id = mapping.mapped_subscription_id',
    );
    expect(sql).toContain(
      'alter table qqbot_message_publish_binding drop column template_id',
    );
    expect(sql).toContain('drop index uk_qqbot_message_delivery_event_target');
    expect(sql).toContain(
      'add unique key uk_qqbot_message_delivery_event_target_template (message_event_id, publish_target_id, template_id)',
    );
  });

  it.each(menuSeedFiles)(
    '%s seeds message management separately while retaining QQBot delivery permissions',
    (relativePath) => {
      const sql = readNormalizedSql(relativePath);

      expect(sql).toContain("'messagemanagement'");
      expect(sql).toContain("'/message-management'");
      expect(sql).toContain("'messagemanagementtemplate'");
      expect(sql).toContain("'/message-management/template'");
      expect(sql).toContain("'/message-management/template/list'");
      expect(sql).toContain("'messagemanagementsubscription'");
      expect(sql).toContain("'/message-management/subscription'");
      expect(sql).toContain("'/message-management/subscription/list'");
      expect(sql).toContain("'messagemanagementstationnoticesubscriber'");
      expect(sql).toContain("'/message-management/subscribers/station-notice'");
      expect(sql).toContain(
        "'/message-management/subscribers/station-notice/list'",
      );
      expect(sql).toContain("'messagemanagement:template:list'");
      expect(sql).toContain("'messagemanagement:subscription:list'");
      expect(sql).toContain("'messagemanagement:push:list'");
      expect(sql).toContain("'qqbot:account:messagepush:list'");
      expect(sql).not.toContain("'qqbotmessagesubscription'");
      expect(sql).not.toContain("'qqbotmessagetemplate'");
      expect(sql).not.toContain("'/qqbot/message-subscription'");
      expect(sql).not.toContain("'/qqbot/message-template'");
    },
  );

  it('verifies protocol columns, template associations, and per-template deliveries', () => {
    const incrementalVerify = readNormalizedSql(
      'sql/qqbot-message-push-verify.sql',
    );
    const fullVerify = readNormalizedSql('sql/refactor-v3/99-verify.sql');

    for (const tableName of [
      'message_subscription',
      'message_template',
      'message_subscription_template',
      'message_event',
      'qqbot_message_publish_binding',
      'qqbot_message_publish_target',
      'qqbot_message_delivery',
      'station_notice_message_binding',
    ]) {
      expect(incrementalVerify).toContain(`'${tableName}'`);
      expect(fullVerify).toContain(`'${tableName}'`);
    }
    expect(incrementalVerify).toContain(
      "'message_subscription_without_template'",
    );
    expect(incrementalVerify).toContain("'message_subscription_mixed_source'");
    expect(incrementalVerify).toContain(
      'group by message_event_id, publish_target_id, template_id',
    );
    expect(incrementalVerify).toContain(
      "'qqbot_binding_forbidden_template_column'",
    );
    expect(incrementalVerify).toContain(
      "'message_subscription_forbidden_source_column'",
    );
  });
});
