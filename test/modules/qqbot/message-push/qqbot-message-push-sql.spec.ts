import { readFileSync } from 'fs';
import { resolve } from 'path';

type MenuEntry = readonly [
  id: string,
  pid: string,
  name: string,
  authCode: string,
  sort: string,
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

/**
 * Normalizes SQL syntax while preserving the exact casing and whitespace inside
 * single-quoted contract values.
 */
const normalizeSql = (sql: string) => {
  let normalized = '';
  let quoted = false;
  let previousWasWhitespace = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quoted) {
      normalized += character;
      if (character === "'" && sql[index + 1] === "'") {
        normalized += sql[index + 1];
        index += 1;
      } else if (character === "'" && sql[index - 1] !== '\\') {
        quoted = false;
      }
      previousWasWhitespace = false;
      continue;
    }
    if (character === "'") {
      quoted = true;
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

/** Reads a repository SQL file as normalized text. */
const readNormalizedSql = (relativePath: string) =>
  normalizeSql(readFileSync(resolve(process.cwd(), relativePath), 'utf8'));

/** Extracts one CREATE TABLE block so assertions cannot match another table. */
const extractCreateTableBlock = (sql: string, table: string) => {
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(
    `create table if not exists ${escapedTable} \\((.*?)\\) engine=innodb default charset=utf8mb4 collate=utf8mb4_unicode_ci;`,
    's',
  ));
  expect(match).toBeTruthy();
  return match?.[0] || '';
};

/** Splits a SQL VALUES tuple without treating quoted JSON or text commas as separators. */
const splitSqlTuple = (tuple: string) => {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < tuple.length; index += 1) {
    const character = tuple[index];
    if (character === "'" && tuple[index + 1] === "'") {
      current += tuple[index + 1];
      index += 1;
      continue;
    }
    if (character === "'" && tuple[index - 1] !== '\\') quoted = !quoted;
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

/** Removes SQL string delimiters from one already-split VALUES field. */
const unquoteSqlValue = (value: string) => value.replace(/^'|'$/g, '');

/** Extracts top-level SQL VALUES tuples while preserving quoted payloads. */
const extractSqlTuples = (values: string) => {
  const tuples: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < values.length; index += 1) {
    const character = values[index];
    if (character === "'" && values[index + 1] === "'") {
      current += values[index + 1];
      index += 1;
      continue;
    }
    if (character === "'" && values[index - 1] !== '\\') quoted = !quoted;
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

/** Extracts every top-level VALUES row from the message-push admin-menu seed statement. */
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

/** Splits SQL statements only at semicolons outside single-quoted values. */
const splitSqlStatements = (sql: string) => {
  const statements: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    current += character;
    if (quoted && character === "'" && sql[index + 1] === "'") {
      current += sql[index + 1];
      index += 1;
      continue;
    }
    if (character === "'" && sql[index - 1] !== '\\') quoted = !quoted;
    if (character === ';' && !quoted) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
};

/** Locates one complete verification statement by its stable check-name literal. */
const extractVerificationStatement = (sql: string, checkName: string) => {
  const statement = splitSqlStatements(sql).find((candidate) => candidate.includes(`'${checkName}'`));
  expect(statement).toBeTruthy();
  return statement || '';
};

/** Extracts the body of the expected_menu CTE without crossing quoted literals. */
const extractExpectedMenuCte = (statement: string) => {
  const cteStart = statement.match(/with expected_menu as \(/);
  expect(cteStart).toBeTruthy();
  const openIndex = (cteStart?.index || 0) + (cteStart?.[0].length || 0) - 1;
  let depth = 0;
  let quoted = false;
  for (let index = openIndex; index < statement.length; index += 1) {
    const character = statement[index];
    if (quoted && character === "'" && statement[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === "'" && statement[index - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return statement.slice(openIndex + 1, index);
    }
  }
  throw new Error('expected_menu CTE is not closed');
};

/** Extracts exact five-column expected-menu tuples from the mismatch CTE. */
const extractMismatchMenuRows = (statement: string): MenuEntry[] => {
  const cte = extractExpectedMenuCte(statement);
  return [...cte.matchAll(/select (\d+)(?: as id)?, (\d+)(?: as pid)?, '((?:''|[^'])*)'(?: as name)?, '((?:''|[^'])*)'(?: as auth_code)?, (\d+)(?: as sort)?/g)]
    .map(([, id, pid, name, authCode, sort]) => [id, pid, name.replace(/''/g, "'"), authCode.replace(/''/g, "'"), sort] as MenuEntry);
};

/** Extracts exact expected-menu IDs from a cardinality or role-grant CTE. */
const extractExpectedMenuIds = (statement: string) =>
  [...extractExpectedMenuCte(statement).matchAll(/select (\d+)(?: as id)?/g)].map(([, id]) => id);

describe('QQBot message-push SQL contract', () => {
  const bootstrapSql = readNormalizedSql('sql/qqbot-init.sql');
  const schemaSql = readNormalizedSql('sql/refactor-v3/00-full-schema.sql');
  const seedSql = readNormalizedSql('sql/refactor-v3/01-seed-core.sql');
  const verifySql = readNormalizedSql('sql/refactor-v3/99-verify.sql');
  const vbenSql = readNormalizedSql('sql/vben-admin-init.sql');

  it('normalizes only SQL syntax and preserves single-quoted contract values exactly', () => {
    expect(normalizeSql("SELECT `AUTH_CODE`, 'QqBot:MessageTemplate:List', '${{endpoint}}'"))
      .toBe("select auth_code, 'QqBot:MessageTemplate:List', '${{endpoint}}'");
  });

  it('keeps each table DDL and index tuple exact in current and refactor schemas', () => {
    for (const [table, expected] of Object.entries(messagePushTableDefinitions)) {
      for (const sql of [bootstrapSql, schemaSql]) {
        const block = extractCreateTableBlock(sql, table);
        let expectedColumns = sql === bootstrapSql
          ? expected.columns.map((column) => column.endsWith(' null') && !column.endsWith('not null')
            ? column.replace(/ null$/, ' default null')
            : column)
          : expected.columns;
        const expectedIndexes = [...expected.indexes];
        if (sql === schemaSql) {
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
  });

  it('keeps every stable menu tuple together and exactly once in every seed file', () => {
    for (const sql of [bootstrapSql, seedSql, vbenSql]) {
      const rows = extractMessagePushMenuRows(sql);
      expect(rows).toHaveLength(18);
      expect(new Set(rows.map(([id]) => id)).size).toBe(18);
      expect(rows).toEqual(menuEntries);
    }
  });

  it('uses an exact mismatch CTE and null-safe predicates for every stable menu tuple', () => {
    const mismatch = extractVerificationStatement(verifySql, 'seed_qqbot_message_push_menu_mismatch');
    expect(extractMismatchMenuRows(mismatch)).toEqual(menuEntries);
    expect(mismatch).toContain('left join admin_menu actual on actual.id = expected.id');
    expect(mismatch).toContain('actual.name <> expected.name');
    expect(mismatch).toContain('not (actual.auth_code <=> expected.auth_code)');
    expect(mismatch).toContain('actual.pid <> expected.pid');
    expect(mismatch).toContain('actual.sort <> expected.sort');
    expect(mismatch).toContain('actual.status <> 1');
    expect(mismatch).toContain('actual.is_deleted <> 0');
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
});
