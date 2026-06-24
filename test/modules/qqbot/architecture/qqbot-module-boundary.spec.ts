import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, relative } from 'path';

const repoRoot = join(__dirname, '../../../..');
const qqbotRoot = join(repoRoot, 'src/modules/qqbot');

/**
 * 执行 测试断言流程。
 * @param root - root 输入；驱动 `readdirSync()`、`join()` 的 测试步骤。
 * @returns 测试断言渲染后的图片、画布或文本。
 */
const collectTsFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    const filePath = join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return collectTsFiles(filePath);
    return filePath.endsWith('.ts') ? [filePath] : [];
  });
};

/**
 * 读取 测试断言资源。
 * @param filePath - 测试路径；读取本地文件内容。
 */
const readSource = (filePath: string) => readFileSync(filePath, 'utf8');

/**
 * 执行 测试断言流程。
 * @param filePath - 测试路径；驱动 `relative()` 的 测试步骤。
 */
const toRepoPath = (filePath: string) =>
  relative(repoRoot, filePath).replace(/\\/g, '/');

/**
 * 列出Top Level Entries。
 * @param moduleName - 模块名称文本；驱动 `join()` 的 测试步骤。
 */
const listTopLevelEntries = (moduleName: string) => {
  const root = join(qqbotRoot, moduleName);
  return readdirSync(root)
    .map((name) => {
      const filePath = join(root, name);
      const stat = statSync(filePath);
      return {
        isDirectory: stat.isDirectory(),
        name,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

describe('QQBot third-phase module boundaries', () => {
  it('keeps core, plugin-platform, and napcat top-level structure strict', () => {
    const allowedDirectories = new Set([
      'application',
      'contract',
      'domain',
      'infrastructure',
      'schema',
    ]);
    const moduleSpecificAllowedDirectories = new Map([
      ['napcat', new Set(['webui-gateway'])],
    ]);
    const allowedRootFiles = new Set(['index.ts']);

    const violations = ['core', 'plugin-platform', 'napcat'].flatMap(
      (moduleName) =>
        listTopLevelEntries(moduleName)
          .filter((entry) =>
            entry.isDirectory
              ? !allowedDirectories.has(entry.name) &&
                !moduleSpecificAllowedDirectories
                  .get(moduleName)
                  ?.has(entry.name)
              : !allowedRootFiles.has(entry.name) &&
                !entry.name.endsWith('.module.ts'),
          )
          .map((entry) => `${moduleName}/${entry.name}`),
    );

    expect(violations).toEqual([]);
  });

  it('prevents QQBot core from importing concrete plugin implementation', () => {
    const violations = collectTsFiles(join(qqbotRoot, 'core'))
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .filter(({ source }) =>
        /@\/modules\/qqbot\/plugins\/|src\/modules\/qqbot\/plugins\//.test(
          source,
        ),
      )
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });

  it('prevents QQBot core application from importing NapCat infrastructure or persistence directly', () => {
    const violations = collectTsFiles(join(qqbotRoot, 'core/application'))
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .flatMap(({ file, source }) => {
        const bannedPatterns = [
          /@\/modules\/qqbot\/napcat\/infrastructure\//,
          /NapcatAccountBinding/,
          /NapcatContainer/,
          /QqbotNapcatContainerService/,
          /@InjectRepository\(Napcat/,
        ];
        return bannedPatterns
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${file}: ${pattern}`);
      });

    expect(violations).toEqual([]);
  });

  it('keeps QqbotCoreModule free of plugin platform controllers, registries, SDKs, and concrete plugin services', () => {
    const source = readSource(join(qqbotRoot, 'core/qqbot-core.module.ts'));
    const bannedSymbols = [
      'QqbotPluginController',
      'QqbotPluginHttpClientService',
      'QqbotPluginRegistryService',
      'QqbotEventPluginRegistryService',
      `Qqbot${'BangDream'}`,
      `Qqbot${'Ff14'}`,
      `Qqbot${'Fflogs'}`,
      `Qqbot${'Repeater'}`,
      'BangDreamApplicationService',
    ];

    const violations = bannedSymbols.filter((symbol) =>
      source.includes(symbol),
    );

    expect(violations).toEqual([]);
  });

  it('keeps core domain independent from Nest, TypeORM, Admin, Plugin Platform, Docker, and HTTP implementation', () => {
    const violations = collectTsFiles(join(qqbotRoot, 'core/domain'))
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .filter(({ source }) =>
        /@nestjs\/|typeorm|@\/modules\/admin|@\/modules\/qqbot\/plugin-platform|child_process|docker|ssh|axios|fetch\(/i.test(
          source,
        ),
      )
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });

  it('keeps Docker and SSH shell construction inside napcat infrastructure integration only', () => {
    const violations = collectTsFiles(join(qqbotRoot, 'napcat'))
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .filter(({ file, source }) => {
        if (file.includes('/napcat/infrastructure/integration/')) {
          return false;
        }
        return /child_process|spawn\(|\bssh\b|\bdocker\b|docker run|docker logs/i.test(
          source,
        );
      })
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });

  it('keeps NapCat WebUI HTTP clients inside infrastructure integration', () => {
    const violations = collectTsFiles(join(qqbotRoot, 'napcat/application'))
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .filter(({ source }) =>
        /from ['"]https?['"]|import \* as https?|client\.request|http\.request|https\.request|Credential.*expiresAt/.test(
          source,
        ),
      )
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });

  it('has schema ownership notes for each QQBot runtime module', () => {
    const missing = ['core', 'plugin-platform', 'napcat']
      .map((moduleName) => join(qqbotRoot, moduleName, 'schema/README.md'))
      .filter((filePath) => !existsSync(filePath))
      .map(
        (filePath) => `${basename(join(filePath, '../..'))}/schema/README.md`,
      );

    expect(missing).toEqual([]);
  });
});
