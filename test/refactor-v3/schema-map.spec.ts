import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

const extractSchemaMapTables = () => {
  const schemaMap = readFileSync(
    join(root, 'docs/refactor-v3/schema-map.md'),
    'utf8',
  );

  const matches = schemaMap.match(/`[a-z][a-z0-9_]+`/g) || [];

  return Array.from(
    new Set(
      matches
        .map((match) => match.slice(1, -1))
        .filter((tableName) => !tableName.endsWith('_*')),
    ),
  ).sort();
};

describe('refactor v3 schema skeleton', () => {
  it('declares every table listed in the schema map in the full schema file', () => {
    const sql = readFileSync(
      join(root, 'sql/refactor-v3/00-full-schema.sql'),
      'utf8',
    );
    const requiredTables = extractSchemaMapTables();

    expect(requiredTables.length).toBeGreaterThan(50);

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('declares core seed and verification scripts', () => {
    const seed = readFileSync(
      join(root, 'sql/refactor-v3/01-seed-core.sql'),
      'utf8',
    );
    const verify = readFileSync(
      join(root, 'sql/refactor-v3/99-verify.sql'),
      'utf8',
    );

    expect(seed).toContain('INSERT INTO admin_user');
    expect(seed).toContain('INSERT INTO qqbot_command');
    expect(seed).toContain('INSERT INTO qqbot_plugin');
    expect(verify).toContain('admin_user');
    expect(verify).toContain('qqbot_command');
    expect(verify).toContain('qqbot_plugin');
    expect(verify).toContain('napcat_device_identity');
  });
});
