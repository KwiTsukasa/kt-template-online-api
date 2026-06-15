import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const srcRoot = join(repoRoot, 'src');

const legacyRoots = ['admin', 'blog', 'minio', 'wordpress', 'qqbot'];
const moduleRoots = ['admin', 'asset', 'blog', 'wordpress', 'qqbot'];
const qqbotRoots = ['core', 'napcat', 'plugin-platform', 'plugins'];

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) return listFiles(absolute);
    return [absolute];
  });
}

function readTextFiles(dir: string): Array<{ file: string; text: string }> {
  return listFiles(dir)
    .filter((file) => /\.(ts|tsx|vue|js|mjs|cjs)$/.test(file))
    .map((file) => ({
      file: relative(repoRoot, file).replace(/\\/g, '/'),
      text: readFileSync(file, 'utf8'),
    }));
}

describe('architecture convergence', () => {
  it('does not keep API legacy source roots', () => {
    const existing = legacyRoots.filter((root) =>
      existsSync(join(srcRoot, root)),
    );

    expect(existing).toEqual([]);
  });

  it('keeps all business modules under src/modules', () => {
    const missing = moduleRoots.filter(
      (root) => !existsSync(join(srcRoot, 'modules', root)),
    );

    expect(missing).toEqual([]);
  });

  it('keeps QQBot subdomains under src/modules/qqbot', () => {
    const missing = qqbotRoots.filter(
      (root) => !existsSync(join(srcRoot, 'modules', 'qqbot', root)),
    );

    expect(missing).toEqual([]);
  });

  it('does not import old roots from src/modules', () => {
    const forbidden = /@\/(?:admin|blog|minio|wordpress|qqbot)\//;
    const offenders = readTextFiles(join(srcRoot, 'modules'))
      .filter(({ text }) => forbidden.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('does not import old roots from app module', () => {
    const appModule = readFileSync(join(srcRoot, 'app.module.ts'), 'utf8');

    expect(appModule).not.toMatch(
      /from ['"]\.\/(?:admin|blog|minio|wordpress|qqbot)/,
    );
    expect(appModule).not.toMatch(
      /from ['"]@\/(?:admin|blog|minio|wordpress|qqbot)\//,
    );
  });
});
