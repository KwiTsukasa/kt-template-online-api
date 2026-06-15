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

const collectFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    const filePath = join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return collectFiles(filePath);
    return [filePath];
  });
};

const toRepoPath = (filePath: string) =>
  relative(repoRoot, filePath).replace(/\\/g, '/');

const requiredPluginPaths = [
  'plugin.json',
  'src/index.ts',
  'src/application',
  'src/config',
  'src/domain',
  'src/infrastructure/integration',
];

const requiredCommandPluginPaths = ['src/operations'];
const requiredEventPluginPaths = ['src/events'];

describe('QQBot plugin package boundary', () => {
  it('does not keep built-in plugin transfer services under plugin-platform', () => {
    expect(
      existsSync(
        join(
          repoRoot,
          'src/modules/qqbot/plugin-platform/infrastructure/integration/builtins',
        ),
      ),
    ).toBe(false);
  });

  it('does not hard-code built-in plugin packages in platform application services', () => {
    const applicationFiles = collectTsFiles(
      join(repoRoot, 'src/modules/qqbot/plugin-platform/application'),
    );

    const violations = applicationFiles.flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      const file = toRepoPath(filePath);
      return [
        source.includes('@/modules/qqbot/plugins/')
          ? `${file} :: concrete plugin import`
          : '',
        /from ['"]node:fs['"]|from ['"]fs['"]|require\(['"](?:node:)?fs['"]\)/.test(
          source,
        )
          ? `${file} :: direct host file IO`
          : '',
      ].filter(Boolean);
    });

    expect(violations).toEqual([]);
  });

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
      (pluginKey) => {
        const manifest = JSON.parse(
          readFileSync(join(pluginRoot, pluginKey, 'plugin.json'), 'utf8'),
        ) as { events?: unknown[]; operations?: unknown[] };
        const requiredPaths = [
          ...requiredPluginPaths,
          ...((manifest.operations || []).length
            ? requiredCommandPluginPaths
            : []),
          ...((manifest.events || []).length ? requiredEventPluginPaths : []),
        ];
        return requiredPaths
          .map((pathName) => `${pluginKey}/${pathName}`)
          .filter((pathName) => !existsSync(join(pluginRoot, pathName)));
      },
    );

    expect(missing).toEqual([]);
  });

  it('does not keep third-phase package directories as empty shells', () => {
    const emptyRequiredDirs = [
      'bangdream',
      'ff14-market',
      'fflogs',
      'repeater',
    ].flatMap((pluginKey) => {
      const manifest = JSON.parse(
        readFileSync(join(pluginRoot, pluginKey, 'plugin.json'), 'utf8'),
      ) as { events?: unknown[]; operations?: unknown[] };
      const requiredDirs = [
        'src/application',
        'src/config',
        'src/domain',
        'src/infrastructure/integration',
        ...((manifest.operations || []).length ? ['src/operations'] : []),
        ...((manifest.events || []).length ? ['src/events'] : []),
      ];
      return requiredDirs
        .map((pathName) => join(pluginRoot, pluginKey, pathName))
        .filter((pathName) => collectTsFiles(pathName).length === 0)
        .map(toRepoPath);
    });

    expect(emptyRequiredDirs).toEqual([]);
  });

  it('does not keep empty .gitkeep placeholder shells in built-in plugin packages', () => {
    const placeholders = readdirSync(pluginRoot)
      .filter((name) => statSync(join(pluginRoot, name)).isDirectory())
      .flatMap((pluginKey) =>
        collectFiles(join(pluginRoot, pluginKey)).filter((filePath) =>
          filePath.endsWith('.gitkeep'),
        ),
      )
      .map(toRepoPath);

    expect(placeholders).toEqual([]);
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

  it('does not keep pure transfer TypeScript files in plugin packages', () => {
    const transferFiles = collectTsFiles(pluginRoot)
      .filter((filePath) => {
        const source = readFileSync(filePath, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '')
          .trim();
        return (
          source.length > 0 &&
          source
            .split(/\r?\n/)
            .every((line) => /^export\s+(?:type\s+)?\*?\s*/.test(line.trim()))
        );
      })
      .map(toRepoPath);

    expect(transferFiles).toEqual([]);
  });
});
