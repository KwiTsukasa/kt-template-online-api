import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads one repository SQL artifact as UTF-8 text. */
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
      'Probe',
      'History',
    ];
    for (const sql of [menuSql, initSql]) {
      expect(sql).toContain("'SystemNetwork'");
      expect(sql).toContain("'/system/network/list'");
      for (const action of actions) {
        expect(sql).toContain(`'SystemNetworkPortForward${action}'`);
        expect(sql).toContain(`'System:Network:PortForward:${action}'`);
      }
      expect(sql).not.toMatch(/PortForward(Check|Ensure)/);
    }
  });

  it('grants every network action only to active super roles', () => {
    expect(menuSql).toContain("role.`role_code` <> 'super'");
    expect(menuSql).toContain("role.`role_code` = 'super'");
    expect(menuSql).toContain('ON DUPLICATE KEY UPDATE');
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

  it('contains no router credential or Palworld-specific schema', () => {
    const allSql = [menuSql, schemaSql, canonicalSchema].join('\n');
    expect(allSql).not.toMatch(
      /router_password|xiaomi_password|palworld|PDC_/i,
    );
  });
});
