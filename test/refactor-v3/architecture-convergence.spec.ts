import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const srcRoot = join(repoRoot, 'src');

const legacyRootNames = ['admin', 'blog', 'minio', 'wordpress', 'qqbot'];
const legacyRootPaths = legacyRootNames.map((root) => join(srcRoot, root));
const moduleRoots = ['admin', 'asset', 'blog', 'wordpress', 'qqbot'];
const qqbotRoots = ['core', 'napcat', 'plugin-platform', 'plugins'];

/**
 * 判断 测试断言条件。
 * @param path - 路由或文件路径；驱动 `existsSync()` 的 测试步骤。
 * @returns 布尔值，表示 测试断言条件是否满足。
 */
function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * 列出Files。
 * @param dir - dir 输入；驱动 `readdirSync()`、`join()` 的 测试步骤。
 * @returns 测试断言查询结果。
 */
function listFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) return listFiles(absolute);
    return [absolute];
  });
}

/**
 * 读取 测试断言资源。
 * @param dir - dir 输入；驱动 `listFiles()` 的 测试步骤。
 * @returns 测试断言渲染后的图片、画布或文本。
 */
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

/**
 * 执行 测试断言流程。
 * @param text - 待匹配文本；提取正则匹配结果。
 * @returns 测试断言渲染后的图片、画布或文本。
 */
function extractImportSpecifiers(text: string): string[] {
  const importPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...text.matchAll(importPattern)]
    .map((match) => match[1] || match[2])
    .filter((specifier): specifier is string => Boolean(specifier));
}

/**
 * 转换 测试断言输入。
 * @param fromFile - fromFile 输入；驱动 `resolve()` 的 测试步骤。
 * @param specifier - specifier 输入；计算 测试布尔判断。
 * @returns 布尔值，表示 测试断言条件是否满足。
 */
function resolvesInsideLegacyRoot(
  fromFile: string,
  specifier: string,
): boolean {
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
    const offenders = readTextFiles(join(srcRoot, 'modules')).flatMap(
      ({ absolute, file, text }) =>
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
