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
    expectFinalSchema(readNormalizedSql('sql/network-management-init.sql'));
    expectFinalSchema(readNormalizedSql('sql/refactor-v3/00-full-schema.sql'));
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

    expect(
      migration.indexOf('network_port_forward_group_id_null_count'),
    ).toBeLessThan(migration.indexOf('modify column group_id bigint not null'));
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
    const fixture = readNormalizedSql(
      'test/admin/network-management/fixtures/network-tcp-natmap-v2-existing-udp.sql',
    );

    expect(fixture).toContain('2041600000000008213');
    expect(fixture).toContain("'udp', 8213, 8211, 'udp:8213'");
    expect(fixture).toContain("17, '2026-07-26 08:00:00.000000', 17, 'synced', 'active'");
    expect(fixture).toContain("'203.0.113.13', 8213");
    expect(fixture).toContain('network_endpoint_history');
    expect(fixture).toContain('network_ddns_record');
    expect(fixture).toContain("'port_forward_ipv4', 2041600000000008213");
    expect(fixture).not.toContain('tcp');
  });
});
