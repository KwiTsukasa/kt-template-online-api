import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMysqlScript } from '../../src/commands/migrate-bot-adapter-protocol';

describe('NATMap port command production migration', () => {
  const migration = readFileSync(
    resolve('sql/natmap-port-command-v1.sql'),
    'utf8',
  );
  const verification = readFileSync(
    resolve('sql/natmap-port-command-v1-verify.sql'),
    'utf8',
  );

  it('inserts only a missing exact identity and rejects key conflicts', () => {
    const statements = parseMysqlScript(migration);
    const procedure = statements.find((statement) =>
      statement.includes(
        'CREATE PROCEDURE `kt_migrate_natmap_port_command_v1`',
      ),
    );

    expect(procedure).toContain("SIGNAL SQLSTATE '45000'");
    expect(procedure).toContain('IF exact_identity_count = 0 THEN');
    expect(procedure).toContain("'natmap.port.current'");
    expect(procedure).toContain("'natmap-port'");
    expect(procedure).not.toContain('ON DUPLICATE KEY UPDATE');
  });

  it('verifies one exact identity with no conflicting or duplicate rows', () => {
    expect(verification).toContain('natmap_command_identity_count');
    expect(verification).toContain('natmap_command_conflict_count');
    expect(verification).toContain('natmap_command_duplicate_count');
    expect(verification).toContain('2041700000000300518');
  });
});
