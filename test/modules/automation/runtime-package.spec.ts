import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTOMATION_SQL_FILES } from '@/commands/automation-migration/schema';

it('最终运行镜像包含迁移器实际读取的每份SQL，新自动化版本由目录规则自动打包', () => {
  const root = resolve(__dirname, '../../..');
  const dockerfile = readFileSync(resolve(root, 'dockerfile'), 'utf8').replace(
    /\\\r?\n\s*/g,
    ' ',
  );
  const runtime = dockerfile.split(/^FROM\s.+$/m).at(-1) ?? '';
  const copies = runtime
    .split('\n')
    .filter((line) => /^COPY\s+.*\s+\.\/sql\/$/.test(line.trim()));
  const patterns = copies
    .flatMap((line) => line.trim().split(/\s+/).slice(1, -1))
    .map(
      (pattern) =>
        new RegExp(
          '^' +
            pattern
              .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
              .replaceAll('*', '.*') +
            '$',
        ),
    );
  for (const file of AUTOMATION_SQL_FILES) {
    expect(existsSync(resolve(root, 'sql', file))).toBe(true);
    expect(patterns.some((pattern) => pattern.test(`sql/${file}`))).toBe(true);
  }
  expect(
    patterns.some((pattern) => pattern.test('sql/automation-future-v99.sql')),
  ).toBe(true);
});
