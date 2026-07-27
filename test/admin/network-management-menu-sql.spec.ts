import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSql(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('System network-management SQL', () => {
  const menuSql = readSql('sql/network-management-menu.sql');
  const initSql = readSql('sql/vben-admin-init.sql');
  const schemaSql = readSql('sql/network-management-init.sql');
  const canonicalSchema = readSql('sql/refactor-v3/00-full-schema.sql');
  const canonicalSeed = readSql('sql/refactor-v3/01-seed-core.sql');
  const canonicalVerify = readSql('sql/refactor-v3/99-verify.sql');

  it('keeps the Admin TSX route and scoped action permissions aligned', () => {
    const actions = [
      'List',
      'Create',
      'Update',
      'Delete',
      'Retry',
      'Keeper',
      'Natmap',
      'Probe',
      'History',
    ];
    for (const sql of [menuSql, initSql, canonicalSeed]) {
      expect(sql).toContain("'SystemNetwork'");
      expect(sql).toContain("'/system/network/list'");
      for (const action of actions) {
        expect(sql).toContain(`'SystemNetworkPortForward${action}'`);
        expect(sql).toContain(`'System:Network:PortForward:${action}'`);
      }
      expect(sql.match(/2041700000000120227/g)).toHaveLength(1);
      expect(sql).not.toMatch(/PortForward(Check|Ensure)/);
    }
  });

  it('grants every network action only to active super roles', () => {
    expect(menuSql).toContain("role.`role_code` <> 'super'");
    expect(menuSql).toContain("role.`role_code` = 'super'");
    expect(menuSql).toContain('ON DUPLICATE KEY UPDATE');
    expect(initSql).toContain('SELECT 2041700000000010001, `id`');
    expect(initSql).toMatch(
      /AND `name` NOT IN \([\s\S]*?'SystemNetworkPortForwardNatmap'/,
    );
    expect(canonicalSeed).toMatch(
      /role\.role_code <> 'super'[\s\S]*?SystemNetworkPortForwardNatmap[\s\S]*?SELECT 2041700000000010001, id/,
    );
  });

  it('defines and verifies all three control-plane tables and singleton seed', () => {
    for (const table of [
      'network_port_forward',
      'network_agent_state',
      'network_endpoint_history',
    ]) {
      expect(schemaSql).toContain(`\`${table}\``);
      expect(canonicalSchema).toContain(` ${table} (`);
      expect(canonicalVerify).toContain(`'${table}' AS table_name`);
    }
    expect(schemaSql).toContain('uk_network_port_forward_active_key');
    expect(schemaSql).toContain('uk_network_endpoint_history_event_id');
    expect(schemaSql).toContain("VALUES ('nas-main', '192.168.31.224'");
    expect(canonicalSeed).toContain("'nas-main'");
  });

  it('verifies group/channel integrity, NATMap permission, and the exact 8213 UDP state', () => {
    for (const checkName of [
      'network_port_forward_group',
      'network_port_forward_active_group_protocol_key_conflicts',
      'network_endpoint_history_mechanism_values',
      'seed_network_natmap_permission',
      'seed_network_natmap_super_permission',
      'network_natmap_non_super_permissions_should_be_zero',
      'network_8213_udp_channel_state',
      'network_8213_udp_ddns_state',
    ]) {
      expect(canonicalVerify).toContain(`'${checkName}'`);
    }
    expect(canonicalVerify).toContain(
      "'uk_network_port_forward_active_group_protocol_key'",
    );
    expect(canonicalVerify).toMatch(
      /external_port\s*=\s*8213[\s\S]*?protocol\s*=\s*'udp'/,
    );
    expect(canonicalVerify).toMatch(
      /port_forward_id\s*=\s*channel\.id[\s\S]*?channel\.external_port\s*=\s*8213/,
    );
    const ddnsDefinition = canonicalSchema.match(
      /CREATE TABLE IF NOT EXISTS network_ddns_record \(([\s\S]*?)\) ENGINE=/,
    )?.[1];
    expect(ddnsDefinition).toBeDefined();
    for (const column of [
      'port_forward_id',
      'record_type',
      'source_type',
      'domain',
      'sub_domain',
      'enabled',
      'sync_status',
      'provider_record_id',
      'source_address',
      'applied_address',
      'retry_count',
      'next_retry_at',
      'last_attempt_at',
      'last_synced_at',
      'last_error_code',
      'last_error_message',
      'is_deleted',
    ]) {
      expect(ddnsDefinition).toMatch(new RegExp(`\\b${column}\\b`));
      expect(canonicalVerify).toContain(`ddns.${column}`);
    }
  });

  it('contains no router credential or Palworld-specific schema', () => {
    const allSql = [
      menuSql,
      initSql,
      schemaSql,
      canonicalSchema,
      canonicalSeed,
      canonicalVerify,
    ].join('\n');
    expect(allSql).not.toMatch(
      /router_password|xiaomi_password|palworld|PDC_|-----BEGIN (?:CERTIFICATE|PRIVATE KEY)-----/i,
    );
    expect(allSql).not.toMatch(
      /NETWORK_DDNS_DNSPOD_SECRET_(?:ID|KEY)\s*=\s*\S+/,
    );
  });
});
