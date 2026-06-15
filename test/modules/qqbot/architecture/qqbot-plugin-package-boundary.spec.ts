import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const repoRoot = join(__dirname, '../../../..');
const pluginRoot = join(repoRoot, 'src/modules/qqbot/plugins');

const collectTsFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    const filePath = join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return collectTsFiles(filePath);
    return filePath.endsWith('.ts') ? [filePath] : [];
  });
};

const toRepoPath = (filePath: string) =>
  relative(repoRoot, filePath).replace(/\\/g, '/');

const requiredPluginPaths = [
  'plugin.json',
  'src/index.ts',
  'src/operations',
  'src/events',
  'src/domain',
  'src/application',
  'src/infrastructure/integration',
  'src/infrastructure/storage',
  'src/config',
  'src/assets',
  'src/migrations',
  'src/tests',
];

describe('QQBot plugin package boundary', () => {
  it('uses only approved built-in plugin package keys as directory names', () => {
    const pluginDirs = readdirSync(pluginRoot)
      .filter((name) => statSync(join(pluginRoot, name)).isDirectory())
      .sort();

    expect(pluginDirs).toEqual([
      'bangdream',
      'ff14-market',
      'fflogs',
      'repeater',
    ]);
  });

  it('uses the same package shape for every built-in plugin', () => {
    const missing = ['bangdream', 'ff14-market', 'fflogs', 'repeater'].flatMap(
      (pluginKey) =>
        requiredPluginPaths
          .map((pathName) => `${pluginKey}/${pathName}`)
          .filter((pathName) => !existsSync(join(pluginRoot, pathName))),
    );

    expect(missing).toEqual([]);
  });

  it('keeps plugin runtime source independent from host internals and direct IO', () => {
    const banned = [
      {
        name: '@nestjs',
        pattern: /@nestjs\//,
      },
      {
        name: 'Admin module import',
        pattern: /@\/modules\/admin\//,
      },
      {
        name: 'QQBot core import',
        pattern: /@\/modules\/qqbot\/core\//,
      },
      {
        name: 'ConfigService',
        pattern: /\bConfigService\b/,
      },
      {
        name: 'DictService',
        pattern: /\bDictService\b/,
      },
      {
        name: 'process.env',
        pattern: /process\.env/,
      },
      {
        name: 'direct axios',
        pattern: /\baxios\b/,
      },
      {
        name: 'direct fetch',
        pattern: /\bfetch\(/,
      },
      {
        name: 'direct fs',
        pattern: /from ['"](?:node:)?fs['"]|require\(['"](?:node:)?fs['"]\)/,
      },
      {
        name: 'import-time timer',
        pattern: /\bset(?:Interval|Timeout)\(/,
      },
    ];

    const violations = collectTsFiles(pluginRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return banned
        .filter(({ pattern }) => pattern.test(source))
        .map(({ name }) => `${toRepoPath(filePath)} :: ${name}`);
    });

    expect(violations).toEqual([]);
  });

  it('uses plugin.json as the only operation metadata source', () => {
    const duplicateMetadataFiles = collectTsFiles(pluginRoot)
      .filter((filePath) => {
        const file = toRepoPath(filePath);
        if (file.endsWith('/src/index.ts')) return false;
        const source = readFileSync(filePath, 'utf8');
        return (
          /operation-registry|COMMAND_DEFINITIONS|OperationDefinition/.test(
            file,
          ) ||
          /operation-registry|COMMAND_DEFINITIONS|OperationDefinition/.test(
            source,
          )
        );
      })
      .map(toRepoPath);

    expect(duplicateMetadataFiles).toEqual([]);
  });
});
