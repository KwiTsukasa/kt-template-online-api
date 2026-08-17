import { readFileSync } from 'fs';
import { resolve } from 'path';

type MenuEntry = readonly [
  id: string,
  pid: string,
  name: string,
  authCode: string,
  sort: string,
];

type MessageMenuTitle = readonly [id: string, title: string];

type IndexDefinition = readonly [
  tableName: string,
  indexName: string,
  nonUnique: string,
  sequence: string,
  columnName: string,
];

const messagePushTableDefinitions = {
  qqbot_message_subscription: {
    columns: [
      'id bigint not null', 'name varchar(100) not null',
      'source_key varchar(128) not null', 'source_config json not null',
      'source_config_digest char(64) not null', 'active_key varchar(255) null',
      'enabled tinyint(1) not null default 1', 'remark varchar(500) null',
      'is_deleted tinyint(1) not null default 0',
      'create_time datetime(6) not null default current_timestamp(6)',
      'update_time datetime(6) not null default current_timestamp(6) on update current_timestamp(6)',
    ],
    indexes: ['primary key (id)', 'unique key uk_qqbot_message_subscription_active_key (active_key)'],
  },
  qqbot_message_template: {
    columns: [
      'id bigint not null', 'name varchar(100) not null',
      'source_key varchar(128) not null', 'content text not null',
      'enabled tinyint(1) not null default 1', 'remark varchar(500) null',
      'is_deleted tinyint(1) not null default 0',
      'create_time datetime(6) not null default current_timestamp(6)',
      'update_time datetime(6) not null default current_timestamp(6) on update current_timestamp(6)',
    ],
    indexes: ['primary key (id)'],
  },
  qqbot_message_publish_binding: {
    columns: [
      'id bigint not null', 'subscription_id bigint not null',
      'account_id bigint not null', 'self_id varchar(64) not null',
      'template_id bigint not null', 'active_key varchar(255) null',
      'enabled tinyint(1) not null default 1', 'is_deleted tinyint(1) not null default 0',
      'create_time datetime(6) not null default current_timestamp(6)',
      'update_time datetime(6) not null default current_timestamp(6) on update current_timestamp(6)',
    ],
    indexes: ['primary key (id)', 'unique key uk_qqbot_message_publish_binding_active_key (active_key)'],
  },
  qqbot_message_publish_target: {
    columns: [
      'id bigint not null', 'binding_id bigint not null',
      'target_type varchar(16) not null', 'target_id varchar(64) not null',
      'target_name varchar(120) null', 'active_key varchar(300) null',
      'enabled tinyint(1) not null default 1', 'is_deleted tinyint(1) not null default 0',
      'create_time datetime(6) not null default current_timestamp(6)',
      'update_time datetime(6) not null default current_timestamp(6) on update current_timestamp(6)',
    ],
    indexes: ['primary key (id)', 'unique key uk_qqbot_message_publish_target_active_key (active_key)'],
  },
  qqbot_message_event: {
    columns: [
      'id bigint not null', 'event_id varchar(128) not null',
      'source_key varchar(128) not null', 'resource_key varchar(128) not null',
      'occurred_at datetime(6) not null', 'payload json not null',
      "fanout_status varchar(32) not null default 'accepted'", 'fanout_attempt_count int unsigned not null default 0',
      'next_fanout_at datetime(6) null', 'fanout_lease_until datetime(6) null',
      'last_error_code varchar(64) null', 'last_error_message varchar(500) null',
      'create_time datetime(6) not null default current_timestamp(6)',
      'update_time datetime(6) not null default current_timestamp(6) on update current_timestamp(6)',
    ],
    indexes: [
      'primary key (id)', 'unique key uk_qqbot_message_event_event_id (event_id)',
      'key idx_qqbot_message_event_dispatch (fanout_status, next_fanout_at)',
      'key idx_qqbot_message_event_lease (fanout_lease_until)',
      'key idx_qqbot_message_event_source_resource_order (source_key, resource_key, occurred_at, id)',
    ],
  },
  qqbot_message_delivery: {
    columns: [
      'id bigint not null', 'message_event_id bigint not null',
      'publish_target_id bigint not null', 'binding_id bigint not null',
      'subscription_id bigint not null', 'self_id varchar(64) not null',
      'target_type varchar(16) not null', 'target_id varchar(64) not null',
      'template_id bigint not null', 'template_content text not null',
      'variable_snapshot json not null', 'rendered_message text not null',
      'status varchar(32) not null', 'attempt_count int unsigned not null default 0',
      'next_attempt_at datetime(6) null', 'processing_lease_until datetime(6) null',
      'send_log_id bigint null', 'last_error_code varchar(64) null',
      'last_error_message varchar(500) null', 'expires_at datetime(6) not null',
      'create_time datetime(6) not null default current_timestamp(6)',
      'update_time datetime(6) not null default current_timestamp(6) on update current_timestamp(6)',
    ],
    indexes: [
      'primary key (id)', 'unique key uk_qqbot_message_delivery_event_target (message_event_id, publish_target_id)',
      'key idx_qqbot_message_delivery_dispatch (status, next_attempt_at)',
      'key idx_qqbot_message_delivery_lease (processing_lease_until)',
      'key idx_qqbot_message_delivery_history (subscription_id, message_event_id)',
    ],
  },
} as const;

const menuEntries: readonly MenuEntry[] = [
  ['2041700000000100413', '2041700000000100400', 'QqBotMessageSubscription', 'QqBot:MessageSubscription:List', '10'],
  ['2041700000000100414', '2041700000000100400', 'QqBotMessageTemplate', 'QqBot:MessageTemplate:List', '11'],
  ['2041700000000120461', '2041700000000100413', 'QqBotMessageSubscriptionList', 'QqBot:MessageSubscription:List', '0'],
  ['2041700000000120462', '2041700000000100413', 'QqBotMessageSubscriptionCreate', 'QqBot:MessageSubscription:Create', '0'],
  ['2041700000000120463', '2041700000000100413', 'QqBotMessageSubscriptionUpdate', 'QqBot:MessageSubscription:Update', '0'],
  ['2041700000000120464', '2041700000000100413', 'QqBotMessageSubscriptionDelete', 'QqBot:MessageSubscription:Delete', '0'],
  ['2041700000000120465', '2041700000000100413', 'QqBotMessageSubscriptionToggle', 'QqBot:MessageSubscription:Toggle', '0'],
  ['2041700000000120471', '2041700000000100414', 'QqBotMessageTemplateList', 'QqBot:MessageTemplate:List', '0'],
  ['2041700000000120472', '2041700000000100414', 'QqBotMessageTemplateCreate', 'QqBot:MessageTemplate:Create', '0'],
  ['2041700000000120473', '2041700000000100414', 'QqBotMessageTemplateUpdate', 'QqBot:MessageTemplate:Update', '0'],
  ['2041700000000120474', '2041700000000100414', 'QqBotMessageTemplateDelete', 'QqBot:MessageTemplate:Delete', '0'],
  ['2041700000000120475', '2041700000000100414', 'QqBotMessageTemplateToggle', 'QqBot:MessageTemplate:Toggle', '0'],
  ['2041700000000120476', '2041700000000100414', 'QqBotMessageTemplatePreview', 'QqBot:MessageTemplate:Preview', '0'],
  ['2041700000000120481', '2041700000000100410', 'QqBotAccountMessagePushList', 'QqBot:Account:MessagePush:List', '0'],
  ['2041700000000120482', '2041700000000100410', 'QqBotAccountMessagePushCreate', 'QqBot:Account:MessagePush:Create', '0'],
  ['2041700000000120483', '2041700000000100410', 'QqBotAccountMessagePushUpdate', 'QqBot:Account:MessagePush:Update', '0'],
  ['2041700000000120484', '2041700000000100410', 'QqBotAccountMessagePushDelete', 'QqBot:Account:MessagePush:Delete', '0'],
  ['2041700000000120485', '2041700000000100410', 'QqBotAccountMessagePushToggle', 'QqBot:Account:MessagePush:Toggle', '0'],
];

const messageMenuTitles: readonly MessageMenuTitle[] = [
  ['2041700000000100413', '消息订阅'],
  ['2041700000000100414', '消息模板'],
];

const requiredIndexDefinitions: readonly IndexDefinition[] = [
  ['qqbot_message_subscription', 'PRIMARY', '0', '1', 'id'],
  ['qqbot_message_subscription', 'uk_qqbot_message_subscription_active_key', '0', '1', 'active_key'],
  ['qqbot_message_template', 'PRIMARY', '0', '1', 'id'],
  ['qqbot_message_publish_binding', 'PRIMARY', '0', '1', 'id'],
  ['qqbot_message_publish_binding', 'uk_qqbot_message_publish_binding_active_key', '0', '1', 'active_key'],
  ['qqbot_message_publish_target', 'PRIMARY', '0', '1', 'id'],
  ['qqbot_message_publish_target', 'uk_qqbot_message_publish_target_active_key', '0', '1', 'active_key'],
  ['qqbot_message_event', 'PRIMARY', '0', '1', 'id'],
  ['qqbot_message_event', 'uk_qqbot_message_event_event_id', '0', '1', 'event_id'],
  ['qqbot_message_event', 'idx_qqbot_message_event_dispatch', '1', '1', 'fanout_status'],
  ['qqbot_message_event', 'idx_qqbot_message_event_dispatch', '1', '2', 'next_fanout_at'],
  ['qqbot_message_event', 'idx_qqbot_message_event_lease', '1', '1', 'fanout_lease_until'],
  ['qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', '1', '1', 'source_key'],
  ['qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', '1', '2', 'resource_key'],
  ['qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', '1', '3', 'occurred_at'],
  ['qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', '1', '4', 'id'],
  ['qqbot_message_delivery', 'PRIMARY', '0', '1', 'id'],
  ['qqbot_message_delivery', 'uk_qqbot_message_delivery_event_target', '0', '1', 'message_event_id'],
  ['qqbot_message_delivery', 'uk_qqbot_message_delivery_event_target', '0', '2', 'publish_target_id'],
  ['qqbot_message_delivery', 'idx_qqbot_message_delivery_dispatch', '1', '1', 'status'],
  ['qqbot_message_delivery', 'idx_qqbot_message_delivery_dispatch', '1', '2', 'next_attempt_at'],
  ['qqbot_message_delivery', 'idx_qqbot_message_delivery_lease', '1', '1', 'processing_lease_until'],
  ['qqbot_message_delivery', 'idx_qqbot_message_delivery_history', '1', '1', 'subscription_id'],
  ['qqbot_message_delivery', 'idx_qqbot_message_delivery_history', '1', '2', 'message_event_id'],
];

const advanceSqlQuoteState = (sql: string, index: number, quoted: boolean) => {
  if (sql[index] !== "'") return { quoted, skipNext: false };

  let precedingBackslashes = 0;
  for (let cursor = index - 1; sql[cursor] === '\\'; cursor -= 1) precedingBackslashes += 1;
  if (precedingBackslashes % 2 === 1) return { quoted, skipNext: false };
  if (quoted && sql[index + 1] === "'") return { quoted, skipNext: true };
  return {
    quoted: !quoted,
    skipNext: false,
  };
};

const normalizeSql = (sql: string) => {
  let normalized = '';
  let quoted = false;
  let previousWasWhitespace = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quoted) {
      normalized += character;
      const quoteState = advanceSqlQuoteState(sql, index, quoted);
      if (quoteState.skipNext) {
        normalized += sql[index + 1];
        index += 1;
      }
      quoted = quoteState.quoted;
      previousWasWhitespace = false;
      continue;
    }
    if (character === "'") {
      quoted = advanceSqlQuoteState(sql, index, quoted).quoted;
      normalized += character;
      previousWasWhitespace = false;
      continue;
    }
    if (character === '`') continue;
    if (/\s/.test(character)) {
      if (!previousWasWhitespace) normalized += ' ';
      previousWasWhitespace = true;
      continue;
    }
    normalized += character.toLowerCase();
    previousWasWhitespace = false;
  }

  return normalized.trim();
};

const readNormalizedSql = (relativePath: string) =>
  normalizeSql(readFileSync(resolve(process.cwd(), relativePath), 'utf8'));

const extractCreateTableBlock = (sql: string, table: string) => {
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(
    `create table if not exists ${escapedTable} \\((.*?)\\) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;`,
    's',
  ));
  expect(match).toBeTruthy();
  return match?.[0] || '';
};

const splitSqlTuple = (tuple: string) => {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < tuple.length; index += 1) {
    const character = tuple[index];
    const quoteState = advanceSqlQuoteState(tuple, index, quoted);
    if (quoteState.skipNext) {
      current += tuple[index + 1];
      index += 1;
      continue;
    }
    quoted = quoteState.quoted;
    if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  values.push(current.trim());
  return values;
};

const unquoteSqlValue = (value: string) => value.replace(/^'|'$/g, '');

const extractSqlTuples = (values: string) => {
  const tuples: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < values.length; index += 1) {
    const character = values[index];
    const quoteState = advanceSqlQuoteState(values, index, quoted);
    if (quoteState.skipNext) {
      current += values[index + 1];
      index += 1;
      continue;
    }
    quoted = quoteState.quoted;
    if (!quoted && character === '(') {
      depth += 1;
      if (depth === 1) current = '';
      else current += character;
      continue;
    }
    if (!quoted && character === ')') {
      depth -= 1;
      if (depth === 0) tuples.push(current);
      else current += character;
      continue;
    }
    if (depth > 0) current += character;
  }
  return tuples;
};

const extractMessagePushMenuRows = (sql: string) => {
  const statements = [...sql.matchAll(/insert into admin_menu \([^)]*\) values (.*?) on duplicate key update/gs)];
  const statement = statements.find((candidate) => candidate[1].includes(menuEntries[0][0]));
  expect(statement).toBeTruthy();
  const values = statement?.[1] || '';
  const tuples = extractSqlTuples(values);
  return tuples
    .map(splitSqlTuple)
    .map((fields) => [
      unquoteSqlValue(fields[0]), unquoteSqlValue(fields[1]),
      unquoteSqlValue(fields[2]), unquoteSqlValue(fields[6]),
      unquoteSqlValue(fields[10]),
    ] as MenuEntry);
};

const extractMessagePushMenuTitles = (sql: string): MessageMenuTitle[] => {
  const statements = [...sql.matchAll(/insert into admin_menu \([^)]*\) values (.*?) on duplicate key update/gs)];
  const statement = statements.find((candidate) => candidate[1].includes(menuEntries[0][0]));
  expect(statement).toBeTruthy();
  return extractSqlTuples(statement?.[1] || '')
    .map(splitSqlTuple)
    .filter((fields) => messageMenuTitles.some(([id]) => id === unquoteSqlValue(fields[0])))
    .map((fields) => [
      unquoteSqlValue(fields[0]),
      JSON.parse(unquoteSqlValue(fields[8])).title,
    ] as MessageMenuTitle);
};

const extractMessagePushMenuRoleGrantStatement = (sql: string) => {
  const statements = splitSqlStatements(sql);
  const menuSeedIndex = statements.findIndex((statement) =>
    statement.startsWith('insert into admin_menu') && statement.includes(menuEntries[0][0]));
  expect(menuSeedIndex).toBeGreaterThanOrEqual(0);
  const roleGrantIndex = statements.findIndex((statement, index) =>
    index > menuSeedIndex && statement.startsWith('insert ignore into admin_role_menu'));
  expect(roleGrantIndex).toBeGreaterThan(menuSeedIndex);
  return statements[roleGrantIndex] || '';
};

const extractMenuRoleGrantIds = (statement: string) => {
  const ids = statement.match(/menu\.id in \(([^)]*)\)/)?.[1].match(/\d+/g) || [];
  return ids;
};

const splitSqlStatements = (sql: string) => {
  const statements: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    current += character;
    const quoteState = advanceSqlQuoteState(sql, index, quoted);
    if (quoteState.skipNext) {
      current += sql[index + 1];
      index += 1;
      continue;
    }
    quoted = quoteState.quoted;
    if (character === ';' && !quoted) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
};

const extractVerificationStatement = (sql: string, checkName: string) => {
  const statement = splitSqlStatements(sql).find((candidate) => candidate.includes(`'${checkName}'`));
  expect(statement).toBeTruthy();
  return statement || '';
};

const extractRequiredIndexDefinitions = (statement: string): IndexDefinition[] =>
  [...statement.matchAll(/(?:select|union all select) '([^']+)'(?: as table_name)?, '([^']+)'(?: as index_name)?, (\d+)(?: as non_unique)?, (\d+)(?: as seq_in_index)?, '([^']+)'(?: as column_name)?/g)]
    .map(([, tableName, indexName, nonUnique, sequence, columnName]) =>
      [tableName, indexName, nonUnique, sequence, columnName] as IndexDefinition);

const summarizeIndexDefinitions = (
  required: readonly IndexDefinition[],
  actual: readonly IndexDefinition[],
) => {
  const requiredKeys = new Set(required.map((definition) => definition.join('\u0000')));
  const actualKeys = new Set(actual.map((definition) => definition.join('\u0000')));
  return {
    missing: [...requiredKeys].filter((key) => !actualKeys.has(key)).length,
    unexpected: [...actualKeys].filter((key) => !requiredKeys.has(key)).length,
  };
};

const extractExpectedMenuCte = (statement: string) => {
  const cteStart = statement.match(/with expected_menu as \(/);
  expect(cteStart).toBeTruthy();
  const openIndex = (cteStart?.index || 0) + (cteStart?.[0].length || 0) - 1;
  let depth = 0;
  let quoted = false;
  for (let index = openIndex; index < statement.length; index += 1) {
    const character = statement[index];
    const quoteState = advanceSqlQuoteState(statement, index, quoted);
    if (quoteState.skipNext) {
      index += 1;
      continue;
    }
    quoted = quoteState.quoted;
    if (quoted) continue;
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return statement.slice(openIndex + 1, index);
    }
  }
  throw new Error('expected_menu CTE is not closed');
};

const extractMismatchMenuRows = (statement: string): MenuEntry[] => {
  const cte = extractExpectedMenuCte(statement);
  return [...cte.matchAll(/select (\d+)(?: as id)?, (\d+)(?: as pid)?, '((?:''|[^'])*)'(?: as name)?, '((?:''|[^'])*)'(?: as auth_code)?, (\d+)(?: as sort)?/g)]
    .map(([, id, pid, name, authCode, sort]) => [id, pid, name.replace(/''/g, "'"), authCode.replace(/''/g, "'"), sort] as MenuEntry);
};

const extractExpectedMenuIds = (statement: string) =>
  [...extractExpectedMenuCte(statement).matchAll(/select (\d+)(?: as id)?/g)].map(([, id]) => id);

describe('QQBot message-push SQL contract', () => {
  const tcpSourceAdapter = readFileSync(
    resolve(
      process.cwd(),
      'src/modules/admin/platform-config/network-management/infrastructure/integration/network-tcp-natmap-message-source.adapter.ts',
    ),
    'utf8',
  );
  const bootstrapSql = readNormalizedSql('sql/qqbot-init.sql');
  const migrationSql = readNormalizedSql('sql/qqbot-message-push-init.sql');
  const migrationVerifySql = readNormalizedSql('sql/qqbot-message-push-verify.sql');
  const schemaSql = readNormalizedSql('sql/refactor-v3/00-full-schema.sql');
  const seedSql = readNormalizedSql('sql/refactor-v3/01-seed-core.sql');
  const verifySql = readNormalizedSql('sql/refactor-v3/99-verify.sql');
  const vbenSql = readNormalizedSql('sql/vben-admin-init.sql');

  it('normalizes only SQL syntax and preserves single-quoted contract values exactly', () => {
    expect(normalizeSql("SELECT `AUTH_CODE`, 'QqBot:MessageTemplate:List', '${{endpoint}}'"))
      .toBe("select auth_code, 'QqBot:MessageTemplate:List', '${{endpoint}}'");
  });

  it('recognizes SQL quote endings, doubled quotes, and odd or even backslashes in every scanner', () => {
    expect(splitSqlTuple("'closed', next")).toEqual(["'closed'", 'next']);
    expect(splitSqlTuple("'it''s closed', next")).toEqual(["'it's closed'", 'next']);
    expect(splitSqlTuple(String.raw`'odd\' quote', next`)).toEqual([String.raw`'odd\' quote'`, 'next']);
    const oddEscapedQuoteThenEnd = String.raw`'odd\''`;
    expect(splitSqlTuple(`${oddEscapedQuoteThenEnd}, next`)).toEqual([oddEscapedQuoteThenEnd, 'next']);
    expect(extractSqlTuples(`(${oddEscapedQuoteThenEnd}), ('next')`)).toEqual([
      oddEscapedQuoteThenEnd,
      "'next'",
    ]);
    expect(splitSqlStatements(`select ${oddEscapedQuoteThenEnd}; select 'next';`)).toEqual([
      `select ${oddEscapedQuoteThenEnd};`,
      "select 'next';",
    ]);
    const cteStatements = splitSqlStatements(
      `with expected_menu as (select ${oddEscapedQuoteThenEnd} as id); select 'next';`,
    );
    expect(cteStatements).toHaveLength(2);
    expect(extractExpectedMenuCte(cteStatements[0])).toBe(`select ${oddEscapedQuoteThenEnd} as id`);
    expect(splitSqlTuple(String.raw`'even\\', next`)).toEqual([String.raw`'even\\'`, 'next']);
    expect(extractSqlTuples(String.raw`('even\\'), ('next')`)).toEqual([String.raw`'even\\'`, "'next'"]);
    expect(splitSqlStatements(String.raw`select 'even\\'; select 'next';`)).toEqual([
      String.raw`select 'even\\';`,
      "select 'next';",
    ]);
  });

  it('keeps each table DDL and index tuple exact in current and refactor schemas', () => {
    for (const [table, expected] of Object.entries(messagePushTableDefinitions)) {
      for (const sql of [bootstrapSql, schemaSql, migrationSql]) {
        const block = extractCreateTableBlock(sql, table);
        let expectedColumns = sql === bootstrapSql
          ? expected.columns.map((column) => column.endsWith(' null') && !column.endsWith('not null')
            ? column.replace(/ null$/, ' default null')
            : column)
          : expected.columns;
        const expectedIndexes = [...expected.indexes];
        if (sql !== bootstrapSql) {
          expectedColumns = expectedColumns.map((column, index) => index === 0
            ? `${column} primary key`
            : column);
          expectedIndexes.shift();
        }
        const expectedBlock = normalizeSql([
          `create table if not exists ${table} (`,
          [...expectedColumns, ...expectedIndexes].join(', '),
          ') engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;',
        ].join(' '));
        expect(block).toBe(expectedBlock);
      }
    }
  });

  it('seeds the exact default template natural key, content, stable ID, and absence guard', () => {
    const expectedTemplate = normalizeSql(`
      insert into qqbot_message_template (id, name, source_key, content, enabled, remark, is_deleted)
      select 2041700000000200601, 'STUN 映射端口变更默认模板',
        'network.stun.mapping-port-changed', '当前STUN的端口已变更为\${{endpoint}}', 1, '系统默认模板', 0
      where not exists (
        select 1 from qqbot_message_template
        where source_key = 'network.stun.mapping-port-changed'
          and name = 'STUN 映射端口变更默认模板' and is_deleted = 0
      );
    `);
    for (const sql of [bootstrapSql, seedSql]) expect(sql).toContain(expectedTemplate);
    expect(migrationSql).toContain(
      expectedTemplate.replace(
        'insert into qqbot_message_template',
        'insert ignore into qqbot_message_template',
      ),
    );
  });

  it('adds the exact TCP NATMap template without changing the STUN template', () => {
    const expectedTcpTemplate = normalizeSql(`
      insert into qqbot_message_template (id, name, source_key, content, enabled, remark, is_deleted)
      select 2041700000000200602, 'TCP NATMap 端点变更默认模板',
        'network.tcp.natmap-endpoint-changed', '当前 TCP NATMap 端点已变更为 \${{endpoint}}', 1, '系统默认模板', 0
      where not exists (
        select 1 from qqbot_message_template
        where source_key = 'network.tcp.natmap-endpoint-changed'
          and name = 'TCP NATMap 端点变更默认模板' and is_deleted = 0
      );
    `);
    for (const sql of [bootstrapSql, seedSql]) {
      expect(sql).toContain(expectedTcpTemplate);
      expect(sql.match(/2041700000000200602/g)).toHaveLength(1);
      expect(sql).toContain(
        "'network.stun.mapping-port-changed', '当前STUN的端口已变更为${{endpoint}}'",
      );
    }
    expect(migrationSql).toContain(
      expectedTcpTemplate.replace(
        'insert into qqbot_message_template',
        'insert ignore into qqbot_message_template',
      ),
    );
    expect(migrationSql.match(/2041700000000200602/g)).toHaveLength(1);
    expect(migrationSql).toContain(
      "'network.stun.mapping-port-changed', '当前STUN的端口已变更为${{endpoint}}'",
    );
  });

  it('keeps the TCP template source key aligned with source version 1', () => {
    expect(tcpSourceAdapter).toMatch(
      /const SOURCE_KEY = 'network\.tcp\.natmap-endpoint-changed';/,
    );
    expect(tcpSourceAdapter).toMatch(/version:\s*1,/);
  });

  it('verifies the default template stable values with case-sensitive text comparisons', () => {
    const defaultTemplateVerify = extractVerificationStatement(verifySql, 'seed_qqbot_message_template');
    expect(defaultTemplateVerify).toBe(normalizeSql(`
      select 'seed_qqbot_message_template' as check_name, count(*) as matched_rows
      from qqbot_message_template
      where id = 2041700000000200601
        and binary name = binary 'STUN 映射端口变更默认模板'
        and binary source_key = binary 'network.stun.mapping-port-changed'
        and binary content = binary '当前STUN的端口已变更为\${{endpoint}}'
        and enabled = 1
        and is_deleted = 0;
    `));
  });

  it('verifies the TCP template stable values in current and migration summaries', () => {
    for (const sql of [verifySql, migrationVerifySql]) {
      const tcpTemplateVerify = extractVerificationStatement(
        sql,
        'seed_qqbot_tcp_natmap_message_template',
      );
      expect(tcpTemplateVerify).toBe(normalizeSql(`
        select 'seed_qqbot_tcp_natmap_message_template' as check_name, count(*) as matched_rows
        from qqbot_message_template
        where id = 2041700000000200602
          and binary name = binary 'TCP NATMap 端点变更默认模板'
          and binary source_key = binary 'network.tcp.natmap-endpoint-changed'
          and binary content = binary '当前 TCP NATMap 端点已变更为 \${{endpoint}}'
          and enabled = 1
          and is_deleted = 0;
      `));
    }
  });

  it('verifies every message-push table with its own complete row-count statement', () => {
    for (const table of Object.keys(messagePushTableDefinitions)) {
      const statement = extractVerificationStatement(verifySql, table);
      expect(statement).toBe(`select '${table}' as table_name, count(*) as row_count from ${table};`);
    }
  });

  it('keeps every stable menu tuple together and exactly once in every seed file', () => {
    for (const sql of [bootstrapSql, seedSql, vbenSql, migrationSql]) {
      const rows = extractMessagePushMenuRows(sql);
      expect(rows).toHaveLength(18);
      expect(new Set(rows.map(([id]) => id)).size).toBe(18);
      expect(rows).toEqual(menuEntries);
      expect(sql).toMatch(/name\s*=\s*values\(name\)/);
    }
  });

  it('keeps the production menu titles aligned with the Admin route titles', () => {
    for (const sql of [bootstrapSql, seedSql, vbenSql, migrationSql]) {
      expect(extractMessagePushMenuTitles(sql)).toEqual(messageMenuTitles);
    }
  });

  it('grants only the seeded message-push menus to active super and admin roles after every menu seed', () => {
    for (const sql of [bootstrapSql, seedSql, vbenSql, migrationSql]) {
      const roleGrant = extractMessagePushMenuRoleGrantStatement(sql);
      expect(roleGrant).toContain('insert ignore into admin_role_menu (role_id, menu_id)');
      expect(extractMenuRoleGrantIds(roleGrant)).toEqual(menuEntries.map(([id]) => id));
      expect(roleGrant).toContain("role.role_code in ('super', 'admin')");
      expect(roleGrant).toContain('role.status = 1');
      expect(roleGrant).toContain('role.is_deleted = 0');
      expect(roleGrant).toContain('menu.status = 1');
      expect(roleGrant).toContain('menu.is_deleted = 0');
    }
  });

  it('keeps the production migration scoped to message-push creation and idempotent seeds', () => {
    expect(migrationSql).not.toMatch(/\b(?:alter table|drop table|drop column|truncate table|delete from)\b/);
    expect(migrationSql).not.toContain('set foreign_key_checks = 0');
    expect(migrationSql.match(/create table if not exists qqbot_message_/g)).toHaveLength(6);
    expect(migrationSql).toContain('on duplicate key update');
    expect(migrationSql).toContain('insert ignore into admin_role_menu');
  });

  it('does not seed real accounts, targets, provider credentials, or certificates', () => {
    const sql = [
      bootstrapSql,
      migrationSql,
      migrationVerifySql,
      seedSql,
      verifySql,
      vbenSql,
    ].join('\n');
    expect(sql).not.toMatch(
      /insert into qqbot_message_(?:publish_binding|publish_target)\b/,
    );
    expect(sql).not.toMatch(/NETWORK_DDNS_DNSPOD_SECRET_(?:ID|KEY)\s*=\s*\S+/);
    expect(sql).not.toMatch(
      /router_password|xiaomi_password|-----BEGIN (?:CERTIFICATE|PRIVATE KEY)-----/i,
    );
  });

  it('keeps the production verification scoped to safe summaries', () => {
    for (const table of Object.keys(messagePushTableDefinitions)) {
      expect(migrationVerifySql).toContain(`'${table}'`);
    }
    expect(extractVerificationStatement(
      migrationVerifySql,
      'seed_qqbot_message_template',
    )).toContain("binary content = binary '当前STUN的端口已变更为${{endpoint}}'");
    expect(extractVerificationStatement(
      migrationVerifySql,
      'seed_qqbot_tcp_natmap_message_template',
    )).toContain("binary content = binary '当前 TCP NATMap 端点已变更为 ${{endpoint}}'");
    expect(extractVerificationStatement(
      migrationVerifySql,
      'seed_qqbot_message_push_menu',
    )).toContain('count(*) as matched_rows');
    const requiredIndexes = extractVerificationStatement(
      migrationVerifySql,
      'qqbot_message_push_required_indexes',
    );
    expect(extractRequiredIndexDefinitions(requiredIndexes)).toEqual(requiredIndexDefinitions);
    expect(requiredIndexes).toContain('actual_index.non_unique = required_index.non_unique');
    expect(requiredIndexes).toContain('actual_index.seq_in_index = required_index.seq_in_index');
    expect(requiredIndexes).toContain('binary actual_index.column_name = binary required_index.column_name');
    expect(requiredIndexes).toContain('unexpected_column_count');
    const pageMenus = extractVerificationStatement(
      migrationVerifySql,
      'seed_qqbot_message_push_page_menu',
    );
    expect(pageMenus).toContain("binary json_unquote(json_extract(meta, '$.title')) = binary '消息订阅'");
    expect(pageMenus).toContain("binary json_unquote(json_extract(meta, '$.title')) = binary '消息模板'");
    expect(extractVerificationStatement(
      migrationVerifySql,
      'seed_qqbot_message_push_role_grant_missing',
    )).toContain('role_menu.menu_id is null');
    expect(migrationVerifySql).not.toMatch(/\b(?:insert|update|delete|alter|drop|truncate|replace)\b/);
  });

  it('rejects a same-name index whose uniqueness, sequence, or column definition drifts', () => {
    const driftedDefinitions = requiredIndexDefinitions.map((definition) =>
      definition[1] === 'idx_qqbot_message_event_dispatch' && definition[3] === '2'
        ? [definition[0], definition[1], definition[2], definition[3], 'occurred_at'] as IndexDefinition
        : definition);
    expect(summarizeIndexDefinitions(requiredIndexDefinitions, driftedDefinitions)).toEqual({
      missing: 1,
      unexpected: 1,
    });
  });

  it('uses an exact mismatch CTE and null-safe predicates for every stable menu tuple', () => {
    for (const sql of [verifySql, migrationVerifySql]) {
      const mismatch = extractVerificationStatement(sql, 'seed_qqbot_message_push_menu_mismatch');
      expect(extractMismatchMenuRows(mismatch)).toEqual(menuEntries);
      expect(mismatch).toContain('left join admin_menu actual on actual.id = expected.id');
      expect(mismatch).toContain('not (binary actual.name <=> binary expected.name)');
      expect(mismatch).toContain('not (binary actual.auth_code <=> binary expected.auth_code)');
      expect(mismatch).toContain('actual.pid <> expected.pid');
      expect(mismatch).toContain('actual.sort <> expected.sort');
      expect(mismatch).toContain('actual.status <> 1');
      expect(mismatch).toContain('actual.is_deleted <> 0');
    }
  });

  it('uses an exact cardinality CTE with expected, actual, and missing counts', () => {
    const cardinality = extractVerificationStatement(verifySql, 'seed_qqbot_message_push_menu_cardinality');
    expect(extractExpectedMenuIds(cardinality)).toEqual(menuEntries.map(([id]) => id));
    expect(cardinality).toContain('left join admin_menu actual on actual.id = expected.id');
    expect(cardinality).toContain('count(*) as expected_count');
    expect(cardinality).toContain('count(actual.id) as actual_count');
    expect(cardinality).toContain('count(*) - count(actual.id) as missing_count');
  });

  it('uses an exact role-grant CTE for enabled super and admin roles', () => {
    const roleGrant = extractVerificationStatement(verifySql, 'seed_qqbot_message_push_menu_role_grant_missing');
    expect(extractExpectedMenuIds(roleGrant)).toEqual(menuEntries.map(([id]) => id));
    expect(roleGrant).toContain('from admin_role role cross join expected_menu expected');
    expect(roleGrant).toContain('left join admin_role_menu role_menu');
    expect(roleGrant).toContain("role.role_code in ('super', 'admin')");
    expect(roleGrant).toContain('role.status = 1');
    expect(roleGrant).toContain('role.is_deleted = 0');
    expect(roleGrant).toContain('role_menu.menu_id is null');
  });

  it('extracts the three message-push verification CTEs as separate statements', () => {
    const checkNames = splitSqlStatements(verifySql)
      .filter((statement) => statement.includes('seed_qqbot_message_push_menu_'))
      .map((statement) => statement.match(/'([^']+)' as check_name/)?.[1]);
    expect(checkNames).toEqual([
      'seed_qqbot_message_push_menu_mismatch',
      'seed_qqbot_message_push_menu_cardinality',
      'seed_qqbot_message_push_menu_role_grant_missing',
    ]);
  });
});
