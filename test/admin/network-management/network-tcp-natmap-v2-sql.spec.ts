import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');

function readNormalizedSql(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractCreateTable(sql: string, tableName: string): string {
  const match = sql.match(
    new RegExp(
      `create table if not exists ${tableName} \\(([\\s\\S]*?)\\) engine=innodb`,
    ),
  );

  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

function splitSqlList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === '(') {
      depth += 1;
    } else if (!quoted && character === ')') {
      depth -= 1;
    } else if (!quoted && depth === 0 && character === ',') {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function canonicalTableMetadata(sql: string, tableName: string): string[] {
  return splitSqlList(extractCreateTable(sql, tableName))
    .flatMap((clause) => {
      const inlinePrimaryKey = clause.match(
        /^([a-z0-9_]+) ([\s\S]+) primary key$/,
      );
      if (!inlinePrimaryKey) return [clause];
      return [
        `${inlinePrimaryKey[1]} ${inlinePrimaryKey[2]}`,
        `primary key (${inlinePrimaryKey[1]})`,
      ];
    })
    .sort();
}

type FixtureRow = Record<string, null | string>;

function parseFixtureRows(sql: string): Record<string, FixtureRow> {
  const rows: Record<string, FixtureRow> = {};
  const normalized = sql
    .replace(/--.*$/gm, '')
    .replace(/`/g, '')
    .trim();
  const inserts = normalized.matchAll(
    /insert into ([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\);/gi,
  );

  for (const insert of inserts) {
    const columns = splitSqlList(insert[2]).map((column) => column.trim());
    const values = splitSqlList(insert[3]).map((value) => {
      const trimmed = value.trim();
      if (trimmed.toLowerCase() === 'null') return null;
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/''/g, "'");
      }
      return trimmed;
    });
    expect(values).toHaveLength(columns.length);
    rows[insert[1].toLowerCase()] = Object.fromEntries(
      columns.map((column, index) => [column, values[index]]),
    );
  }
  return rows;
}

function mutationAssignmentTargets(sql: string, tableName: string): string[] {
  const targets = new Set<string>();
  const updates = sql.matchAll(
    new RegExp(
      `update ${tableName}(?: [a-z0-9_]+)? set ([\\s\\S]*?) where [\\s\\S]*?;`,
      'g',
    ),
  );
  for (const update of updates) {
    for (const assignment of splitSqlList(update[1])) {
      const target = assignment.match(/^(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s*=/);
      expect(target).not.toBeNull();
      if (target) targets.add(target[1]);
    }
  }
  return [...targets].sort();
}

function withoutProperties(row: FixtureRow, properties: string[]): FixtureRow {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !properties.includes(key)),
  );
}

function expectFinalSchema(sql: string): void {
  const group = extractCreateTable(sql, 'network_port_forward_group');
  const channel = extractCreateTable(sql, 'network_port_forward');
  const agent = extractCreateTable(sql, 'network_agent_state');
  const history = extractCreateTable(sql, 'network_endpoint_history');

  for (const column of [
    'id bigint not null',
    'name varchar(100) not null',
    'remark text null',
    'external_port int unsigned not null',
    'internal_port int unsigned not null',
    'protocol_mode varchar(8) not null',
    'target_ipv4 varchar(15) not null',
    'is_deleted tinyint(1) not null default 0',
    'create_time datetime(6) not null',
    'update_time datetime(6) not null',
  ]) {
    expect(group).toContain(column);
  }

  for (const column of [
    'group_id bigint not null',
    'active_group_protocol_key varchar(64) null',
    'natmap_desired_enabled tinyint(1) not null default 0',
    "natmap_status varchar(16) not null default 'disabled'",
    'natmap_last_error_code varchar(64) null',
    'natmap_last_error_message varchar(512) null',
    'keeper_last_error_code varchar(64) null',
    'keeper_last_error_message varchar(512) null',
    'candidate_public_ipv4 varchar(15) null',
    'candidate_public_port int null',
    'candidate_observed_at datetime(6) null',
    'candidate_validated_at datetime(6) null',
    'current_validated_at datetime(6) null',
    'last_observed_validated_at datetime(6) null',
    'last_published_public_ipv4 varchar(15) null',
    'last_published_public_port int null',
    'last_published_at datetime(6) null',
  ]) {
    expect(channel).toContain(column);
  }
  expect(channel).toContain(
    'unique key uk_network_port_forward_active_group_protocol_key (active_group_protocol_key)',
  );
  expect(channel).toContain(
    'key idx_network_port_forward_group (group_id, is_deleted, protocol)',
  );

  for (const column of [
    'desired_schema_version int unsigned not null default 1',
    'published_schema_version int unsigned not null default 1',
    'max_supported_schema_version int unsigned not null default 1',
    'tcp_natmap_capable tinyint(1) not null default 0',
  ]) {
    expect(agent).toContain(column);
  }
  expect(history).toContain("mechanism varchar(16) not null default 'udp_stun'");
}

describe('TCP NATMap v2 schema SQL', () => {
  it('keeps clean init and refactor-v3 schema contracts aligned', () => {
    const cleanInit = readNormalizedSql('sql/network-management-init.sql');
    const refactor = readNormalizedSql('sql/refactor-v3/00-full-schema.sql');

    expectFinalSchema(cleanInit);
    for (const tableName of [
      'network_port_forward_group',
      'network_port_forward',
      'network_agent_state',
      'network_endpoint_history',
    ]) {
      expect(canonicalTableMetadata(cleanInit, tableName)).toEqual(
        canonicalTableMetadata(refactor, tableName),
      );
    }
  });

  it('uses an additive idempotent migration with ordered group backfill', () => {
    const migration = readNormalizedSql('sql/network-tcp-natmap-v2.sql');

    expect(migration).toContain('create table if not exists network_port_forward_group');
    expect(migration).toContain('information_schema.columns');
    expect(migration).toContain('information_schema.statistics');
    expect(migration).toContain('insert into network_port_forward_group');
    expect(migration).toContain('select channel.id, channel.name, channel.remark');
    expect(migration).toContain("'udp'");
    expect(migration).toContain('update network_port_forward channel set group_id = channel.id');
    expect(migration).toContain(
      "active_group_protocol_key = case when channel.is_deleted = 0 then concat(channel.group_id, ':', channel.protocol) else null end",
    );
    expect(migration).toContain('network_port_forward_group_id_null_count');
    expect(migration).toContain('modify column group_id bigint not null');
    expect(migration).not.toContain('group_concat');
    for (const columnName of [
      'natmap_last_error_code',
      'natmap_last_error_message',
      'keeper_last_error_code',
      'keeper_last_error_message',
      'candidate_public_ipv4',
      'candidate_public_port',
      'candidate_observed_at',
      'candidate_validated_at',
      'current_validated_at',
      'last_observed_validated_at',
      'last_published_public_ipv4',
      'last_published_public_port',
      'last_published_at',
      'desired_schema_version',
      'published_schema_version',
      'max_supported_schema_version',
      'tcp_natmap_capable',
    ]) {
      expect(migration).toContain(`column_name = '${columnName}'`);
    }

    const nullGroupAbort = migration.indexOf(
      "signal sqlstate ''45000'' set message_text = ''network_port_forward.group_id backfill incomplete''",
    );
    const groupNotNull = migration.indexOf(
      'modify column group_id bigint not null',
    );
    const activeKeyAbort = migration.indexOf(
      "signal sqlstate ''45000'' set message_text = ''network_port_forward active group/protocol key conflict''",
    );
    const activeKeyUnique = migration.indexOf(
      'add unique key uk_network_port_forward_active_group_protocol_key',
    );

    expect(nullGroupAbort).toBeGreaterThan(-1);
    expect(activeKeyAbort).toBeGreaterThan(-1);
    expect(nullGroupAbort).toBeLessThan(groupNotNull);
    expect(activeKeyAbort).toBeLessThan(activeKeyUnique);
    expect(migration).toMatch(
      /where not \( ?channel\.active_group_protocol_key <=> case when channel\.is_deleted = 0 then concat\(channel\.group_id, ':', channel\.protocol\) else null end ?\)/,
    );

    expect(
      migration.indexOf('network_port_forward_group_id_null_count'),
    ).toBeLessThan(groupNotNull);
    expect(migration).not.toMatch(/\b(drop|truncate|delete)\b/);
    expect(migration).not.toMatch(/\b(rename\s+(table|column))\b/);
    expect(migration).not.toMatch(/foreign\s+key/);
    expect(migration).not.toMatch(
      /update network_port_forward(?:\s+\w+)?\s+set\s+(?:id|protocol|external_port|internal_port|desired_revision|reported_revision|keeper_status|current_public_ipv4|current_public_port|last_observed_ipv4|last_observed_port)\s*=/,
    );
  });

  it('ships a read-only verification query for final constraints', () => {
    const verify = readNormalizedSql('sql/network-tcp-natmap-v2-verify.sql');

    expect(verify).toContain('from network_port_forward_group');
    expect(verify).toContain("column_name = 'group_id'");
    expect(verify).toContain('uk_network_port_forward_active_group_protocol_key');
    expect(verify).toContain('idx_network_port_forward_group');
    expect(verify).not.toMatch(/\b(insert|update|delete|alter|drop|truncate)\b/);
  });

  it('preserves the sanitized existing 8213 UDP channel, history, and DDNS binding', () => {
    const fixturePath =
      'test/admin/network-management/fixtures/network-tcp-natmap-v2-existing-udp.sql';
    const fixture = readNormalizedSql(fixturePath);
    const migration = readNormalizedSql('sql/network-tcp-natmap-v2.sql');
    const before = parseFixtureRows(
      readFileSync(resolve(REPO_ROOT, fixturePath), 'utf8'),
    );
    const beforeChannel = before.network_port_forward;
    const beforeHistory = before.network_endpoint_history;
    const beforeDdns = before.network_ddns_record;
    const afterChannel: FixtureRow = {
      ...beforeChannel,
      active_group_protocol_key: `${beforeChannel.id}:${beforeChannel.protocol}`,
      group_id: beforeChannel.id,
    };
    const afterHistory: FixtureRow = {
      ...beforeHistory,
      mechanism: 'udp_stun',
    };
    const afterDdns: FixtureRow = { ...beforeDdns };

    expect(mutationAssignmentTargets(migration, 'network_port_forward')).toEqual(
      ['active_group_protocol_key', 'group_id'],
    );
    expect(
      mutationAssignmentTargets(migration, 'network_endpoint_history'),
    ).toEqual(['mechanism']);
    expect(migration).not.toMatch(
      /\b(?:update|insert into|replace into) network_ddns_record\b/,
    );
    expect(migration).not.toMatch(
      /\binsert into (?:network_port_forward|network_endpoint_history)\b/,
    );
    expect(
      withoutProperties(afterChannel, [
        'active_group_protocol_key',
        'group_id',
      ]),
    ).toEqual(beforeChannel);
    expect(withoutProperties(afterHistory, ['mechanism'])).toEqual(
      beforeHistory,
    );
    expect(afterDdns).toEqual(beforeDdns);
    expect(afterChannel.id).toBe('2041600000000008213');
    expect(afterChannel.active_key).toBe('udp:8213');
    expect(afterChannel.desired_revision).toBe('17');
    expect(afterChannel.reported_revision).toBe('17');
    expect(afterChannel.keeper_status).toBe('active');
    expect(afterHistory.mapping_id).toBe(afterChannel.id);
    expect(afterDdns.port_forward_id).toBe(afterChannel.id);
    expect(fixture).not.toContain('tcp');
  });
});
