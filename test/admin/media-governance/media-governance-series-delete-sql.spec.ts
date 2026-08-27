import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMysqlScript } from '../../../src/commands/migrate-bot-adapter-protocol';

describe('media governance Series delete permission migration', () => {
  const migration = readFileSync(
    resolve('sql/media-governance-series-delete-v1.sql'),
    'utf8',
  );
  const verification = readFileSync(
    resolve('sql/media-governance-series-delete-v1-verify.sql'),
    'utf8',
  );

  it('inserts only a missing exact permission and removes non-super grants', () => {
    const procedure = parseMysqlScript(migration).find((statement) =>
      statement.includes(
        'CREATE PROCEDURE `kt_migrate_media_series_delete_v1`',
      ),
    );

    expect(procedure).toContain("SIGNAL SQLSTATE '45000'");
    expect(procedure).toContain('IF exact_identity_count = 0 THEN');
    expect(procedure).not.toContain('ON DUPLICATE KEY UPDATE');
    expect(migration).toContain("role.`role_code` <> 'super'");
    expect(migration).toContain("role.`role_code` = 'super'");
  });

  it('verifies identity, conflicts, duplicates and role ownership', () => {
    for (const name of [
      'series_delete_permission_identity_count',
      'series_delete_permission_conflict_count',
      'series_delete_permission_duplicate_count',
      'series_delete_missing_super_binding_count',
      'series_delete_non_super_binding_count',
    ]) {
      expect(verification).toContain(name);
    }
  });
});
