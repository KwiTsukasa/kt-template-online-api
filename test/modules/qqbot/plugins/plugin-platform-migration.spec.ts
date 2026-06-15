import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parseQqbotPluginManifest } from '../../../../src/modules/qqbot/plugin-platform/domain/manifest';

const repoRoot = join(__dirname, '../../../..');
const pluginRoot = join(repoRoot, 'src/modules/qqbot/plugins');
const legacyPluginRoot = join(repoRoot, 'src/qqbot/plugins');

const readJson = (filePath: string) =>
  JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;

const collectFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    const filePath = join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return collectFiles(filePath);
    return [filePath];
  });
};

const importSource = (filePath: string) => readFileSync(filePath, 'utf8');

describe('QQBot existing plugin platform migration', () => {
  it('moves all existing plugin packages under the module plugin platform root', () => {
    expect(
      readdirSync(pluginRoot)
        .filter((name) => statSync(join(pluginRoot, name)).isDirectory())
        .sort(),
    ).toEqual(['bangDream', 'ff14Market', 'fflogs', 'repeater']);

    const legacySources = collectFiles(legacyPluginRoot).filter((filePath) =>
      filePath.endsWith('.ts'),
    );
    expect(legacySources).toEqual([]);
  });

  it('declares parseable platform manifests for every existing plugin', () => {
    const manifests = ['bangDream', 'ff14Market', 'fflogs', 'repeater'].map(
      (pluginName) => {
        const root = join(pluginRoot, pluginName);
        const manifest = parseQqbotPluginManifest(
          readJson(join(root, 'plugin.json')),
          {
            pluginRoot: root,
          },
        );
        return manifest;
      },
    );

    expect(manifests.map((manifest) => manifest.pluginKey).sort()).toEqual([
      'bangdream',
      'ff14-market',
      'fflogs',
      'repeater',
    ]);
    expect(
      manifests.every(
        (manifest) =>
          manifest.permissions.length > 0 &&
          manifest.runtime.timeoutMs > 0 &&
          manifest.runtime.maxConcurrency > 0,
      ),
    ).toBe(true);
  });

  it('keeps BangDream manifest operations aligned with the registry metadata', async () => {
    const { BANGDREAM_OPERATION_REGISTRY } =
      await import('../../../../src/modules/qqbot/plugins/bangDream/registry/operation-registry');
    const manifest = parseQqbotPluginManifest(
      readJson(join(pluginRoot, 'bangDream/plugin.json')),
      {
        pluginRoot: join(pluginRoot, 'bangDream'),
      },
    );

    expect(manifest.operations).toHaveLength(
      BANGDREAM_OPERATION_REGISTRY.length,
    );
    expect(
      manifest.operations.map((operation) => ({
        aliases: operation.aliases,
        handlerName: operation.handlerName,
        key: operation.key,
        name: operation.name,
      })),
    ).toEqual(
      BANGDREAM_OPERATION_REGISTRY.map((operation) => ({
        aliases: [...operation.onlineCommand.aliases],
        handlerName: operation.handlerName,
        key: operation.key,
        name: operation.name,
      })),
    );
  });

  it('routes FF14 Market and FFLogs HTTP through the plugin platform SDK', () => {
    const externalHttpSources = ['ff14Market', 'fflogs'].flatMap((pluginName) =>
      collectFiles(join(pluginRoot, pluginName)).filter((filePath) =>
        filePath.endsWith('.ts'),
      ),
    );

    const directHttpImports = externalHttpSources
      .map((filePath) => ({
        file: relative(repoRoot, filePath).replace(/\\/g, '/'),
        source: importSource(filePath),
      }))
      .filter(({ source }) =>
        /from ['"]node:(?:http|https)['"]|from ['"](?:http|https)['"]|axios/.test(
          source,
        ),
      )
      .map(({ file }) => file);

    expect(directHttpImports).toEqual([]);
  });
});
