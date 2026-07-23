import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Reads one repository SQL artifact as normalized lowercase text.
 * @param relativePath - Path relative to the API repository root.
 * @returns SQL text with identifier quotes and repeated whitespace removed.
 */
function readNormalizedSql(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extracts one CREATE TABLE body from normalized SQL.
 * @param sql - Normalized SQL text.
 * @param tableName - Table whose declaration is required.
 * @returns CREATE TABLE body used by focused schema assertions.
 */
function extractCreateTable(sql: string, tableName: string): string {
  const match = sql.match(
    new RegExp(
      `create table if not exists ${tableName} \\(([\\s\\S]*?)\\) engine=innodb`,
    ),
  );

  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

/**
 * Asserts the complete DDNS table contract shared by incremental and bootstrap SQL.
 * @param sql - Normalized SQL containing the network DDNS table.
 * @returns Nothing; Jest assertions fail when one schema fragment drifts.
 */
function expectDdnsTableContract(sql: string): void {
  const table = extractCreateTable(sql, 'network_ddns_record');
  const requiredColumns = [
    'id bigint not null',
    'name varchar(100) not null',
    'remark text null',
    'record_type varchar(8) not null',
    'source_type varchar(32) not null',
    'port_forward_id bigint null',
    'domain varchar(253) not null',
    'sub_domain varchar(253) not null',
    'active_key varchar(300) null',
    'enabled tinyint(1) not null default 0',
    "sync_status varchar(32) not null default 'disabled'",
    'provider_record_id varchar(32) null',
    'source_address varchar(45) null',
    'applied_address varchar(45) null',
    'retry_count int unsigned not null default 0',
    'next_retry_at datetime(3) null',
    'last_attempt_at datetime(3) null',
    'last_synced_at datetime(3) null',
    'last_error_code varchar(64) null',
    'last_error_message varchar(512) null',
    'is_deleted tinyint(1) not null default 0',
    'create_time datetime(3) not null default current_timestamp(3)',
    'update_time datetime(3) not null default current_timestamp(3) on update current_timestamp(3)',
  ];

  for (const column of requiredColumns) {
    expect(table).toContain(column);
  }

  expect(table).toContain('primary key');
  expect(table).toContain(
    'unique key uk_network_ddns_record_active_key (active_key)',
  );
  expect(table).toContain(
    'key idx_network_ddns_record_status (is_deleted, enabled, sync_status, next_retry_at)',
  );
  expect(table).toContain(
    'key idx_network_ddns_record_port_forward (port_forward_id)',
  );
}

describe('Network DDNS SQL contract', () => {
  it('keeps the DDNS table aligned in incremental and refactor-v3 bootstrap schemas', () => {
    expectDdnsTableContract(
      readNormalizedSql('sql/network-management-init.sql'),
    );
    expectDdnsTableContract(
      readNormalizedSql('sql/refactor-v3/00-full-schema.sql'),
    );
  });

  it('adds idempotent Agent IPv6 columns and verifies the schema indexes', () => {
    const incremental = readNormalizedSql('sql/network-management-init.sql');
    const fullSchema = readNormalizedSql('sql/refactor-v3/00-full-schema.sql');
    const verify = readNormalizedSql('sql/refactor-v3/99-verify.sql');

    for (const sql of [incremental, fullSchema]) {
      const agentState = extractCreateTable(sql, 'network_agent_state');
      expect(agentState).toContain('current_public_ipv6 varchar(45) null');
      expect(agentState).toContain('current_ipv6_observed_at datetime(3) null');
    }

    expect(incremental).toContain(
      'alter table network_agent_state add column current_public_ipv6 varchar(45) null',
    );
    expect(incremental).toContain(
      'alter table network_agent_state add column current_ipv6_observed_at datetime(3) null',
    );
    expect(incremental).toContain(
      "table_name = 'network_agent_state' and column_name = 'current_public_ipv6'",
    );
    expect(incremental).toContain(
      "table_name = 'network_agent_state' and column_name = 'current_ipv6_observed_at'",
    );

    expect(verify).toContain(
      "select 'network_ddns_record' as table_name, count(*) as row_count from network_ddns_record",
    );
    expect(verify).toContain(
      "column_name = 'current_public_ipv6' and column_type = 'varchar(45)'",
    );
    expect(verify).toContain(
      "column_name = 'current_ipv6_observed_at' and column_type = 'datetime(3)'",
    );
    expect(verify).toContain(
      "index_name = 'uk_network_ddns_record_active_key'",
    );
    expect(verify).toContain("index_name = 'idx_network_ddns_record_status'");
    expect(verify).toContain(
      "index_name = 'idx_network_ddns_record_port_forward'",
    );
  });

  it('mirrors stable DDNS permissions and restricts grants to enabled super roles', () => {
    const menu = readNormalizedSql('sql/network-management-menu.sql');
    const seed = readNormalizedSql('sql/refactor-v3/01-seed-core.sql');
    const vben = readNormalizedSql('sql/vben-admin-init.sql');
    const incrementalNonSuperBlock = menu.match(
      /where role\.role_code <> 'super' and menu\.name in \(([\s\S]*?)\);/,
    )?.[1];
    const incrementalSuperBlock = menu.match(
      /join admin_menu menu on menu\.name in \(([\s\S]*?)\) where role\.role_code = 'super'/,
    )?.[1];
    const vbenNonSuperBlock = vben.match(
      /and name not in \(([\s\S]*?)\);/,
    )?.[1];
    const permissions = [
      {
        code: 'system:network:ddns:list',
        id: '2041700000000120222',
        name: 'systemnetworkddnslist',
      },
      {
        code: 'system:network:ddns:create',
        id: '2041700000000120223',
        name: 'systemnetworkddnscreate',
      },
      {
        code: 'system:network:ddns:update',
        id: '2041700000000120224',
        name: 'systemnetworkddnsupdate',
      },
      {
        code: 'system:network:ddns:delete',
        id: '2041700000000120225',
        name: 'systemnetworkddnsdelete',
      },
      {
        code: 'system:network:ddns:retry',
        id: '2041700000000120226',
        name: 'systemnetworkddnsretry',
      },
    ];

    for (const sql of [menu, seed, vben]) {
      for (const permission of permissions) {
        expect(sql).toContain(permission.id);
        expect(sql).toContain(permission.name);
        expect(sql).toContain(permission.code);
      }
    }

    expect(menu).toContain("where role.role_code <> 'super'");
    expect(menu).toContain("where role.role_code = 'super'");
    expect(menu).toContain('and role.status = 1');
    expect(menu).toContain('and role.is_deleted = 0');
    expect(incrementalNonSuperBlock).toBeDefined();
    expect(incrementalSuperBlock).toBeDefined();
    expect(vbenNonSuperBlock).toBeDefined();

    for (const permission of permissions) {
      expect(incrementalNonSuperBlock).toContain(permission.name);
      expect(incrementalSuperBlock).toContain(permission.name);
      expect(vbenNonSuperBlock).toContain(permission.name);
    }
  });
});
