import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import {
  dirname,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const srcRoot = join(repoRoot, 'src');

const legacyRootNames = ['admin', 'blog', 'minio', 'wordpress', 'qqbot'];
const legacyRootPaths = legacyRootNames.map((root) => join(srcRoot, root));
const moduleRoots = ['admin', 'asset', 'blog', 'wordpress', 'qqbot'];
const qqbotRoots = ['core', 'napcat', 'plugin-platform', 'plugins'];

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function listFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) return listFiles(absolute);
    return [absolute];
  });
}

function readTextFiles(
  dir: string,
): Array<{ absolute: string; file: string; text: string }> {
  return listFiles(dir)
    .filter((file) => /\.(ts|tsx|vue|js|mjs|cjs)$/.test(file))
    .map((file) => ({
      absolute: file,
      file: relative(repoRoot, file).replace(/\\/g, '/'),
      text: readFileSync(file, 'utf8'),
    }));
}

function extractImportSpecifiers(text: string): string[] {
  const importPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...text.matchAll(importPattern)]
    .map((match) => match[1] || match[2])
    .filter((specifier): specifier is string => Boolean(specifier));
}

function resolvesInsideLegacyRoot(fromFile: string, specifier: string): boolean {
  let resolved: string | null = null;
  if (specifier === '@') resolved = srcRoot;
  if (specifier.startsWith('@/')) {
    resolved = join(srcRoot, specifier.slice(2));
  }
  if (specifier.startsWith('.')) {
    resolved = resolve(dirname(fromFile), specifier);
  }
  if (!resolved) return false;

  const normalized = normalize(resolved);
  return legacyRootPaths.some((legacyRoot) => {
    const normalizedLegacy = normalize(legacyRoot);
    return (
      normalized === normalizedLegacy ||
      normalized.startsWith(`${normalizedLegacy}${sep}`)
    );
  });
}

describe('architecture convergence', () => {
  it('does not keep API legacy source roots', () => {
    const existing = legacyRootNames.filter((root) =>
      isDirectory(join(srcRoot, root)),
    );

    expect(existing).toEqual([]);
  });

  it('keeps all business modules under src/modules', () => {
    const missing = moduleRoots.filter(
      (root) => !isDirectory(join(srcRoot, 'modules', root)),
    );

    expect(missing).toEqual([]);
  });

  it('keeps QQBot subdomains under src/modules/qqbot', () => {
    const missing = qqbotRoots.filter(
      (root) => !isDirectory(join(srcRoot, 'modules', 'qqbot', root)),
    );

    expect(missing).toEqual([]);
  });

  it('does not import old roots from src/modules', () => {
    const offenders = readTextFiles(join(srcRoot, 'modules'))
      .flatMap(({ absolute, file, text }) =>
        extractImportSpecifiers(text)
          .filter((specifier) => resolvesInsideLegacyRoot(absolute, specifier))
          .map((specifier) => `${file} -> ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  it('does not import old roots from app module', () => {
    const appModulePath = join(srcRoot, 'app.module.ts');
    const appModule = readFileSync(appModulePath, 'utf8');
    const offenders = extractImportSpecifiers(appModule).filter((specifier) =>
      resolvesInsideLegacyRoot(appModulePath, specifier),
    );

    expect(offenders).toEqual([]);
  });
});
