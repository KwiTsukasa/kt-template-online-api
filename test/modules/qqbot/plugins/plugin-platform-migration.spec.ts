import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parseQqbotPluginManifest } from '../../../../src/modules/qqbot/plugin-platform/domain/manifest';

const repoRoot = join(__dirname, '../../../..');
const pluginRoot = join(repoRoot, 'src/modules/qqbot/plugins');
const legacyPluginRoot = join(repoRoot, 'src/qqbot/plugins');

/**
 * 读取 测试断言资源。
 * @param filePath - 测试路径；转换 JSON 文本。
 */
const readJson = (filePath: string) =>
  JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;

/**
 * 执行 测试断言流程。
 * @param root - root 输入；驱动 `readdirSync()`、`join()` 的 测试步骤。
 * @returns 测试断言渲染后的图片、画布或文本。
 */
const collectFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    const filePath = join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return collectFiles(filePath);
    return [filePath];
  });
};

/**
 * 执行 测试断言流程。
 * @param filePath - 测试路径；读取本地文件内容。
 */
const importSource = (filePath: string) => readFileSync(filePath, 'utf8');

describe('QQBot existing plugin platform migration', () => {
  it('moves all existing plugin packages under the module plugin platform root', () => {
    expect(
      readdirSync(pluginRoot)
        .filter((name) => statSync(join(pluginRoot, name)).isDirectory())
        .sort(),
    ).toEqual(['bangdream', 'ff14-market', 'fflogs', 'repeater']);

    const legacySources = collectFiles(legacyPluginRoot).filter((filePath) =>
      filePath.endsWith('.ts'),
    );
    expect(legacySources).toEqual([]);
  });

  it('declares parseable platform manifests for every existing plugin', () => {
    const manifests = ['bangdream', 'ff14-market', 'fflogs', 'repeater'].map(
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

  it('keeps BangDream manifest operations as the single metadata source', () => {
    const manifest = parseQqbotPluginManifest(
      readJson(join(pluginRoot, 'bangdream/plugin.json')),
      {
        pluginRoot: join(pluginRoot, 'bangdream'),
      },
    );

    expect(
      manifest.operations.map((operation) => ({
        handlerName: operation.handlerName,
        key: operation.key,
        name: operation.name,
      })),
    ).toEqual([
      {
        handlerName: 'searchSong',
        key: 'bangdream.song.search',
        name: '查曲',
      },
      {
        handlerName: 'getSongChart',
        key: 'bangdream.song.chart',
        name: '查谱面',
      },
      {
        handlerName: 'randomSong',
        key: 'bangdream.song.random',
        name: '随机曲',
      },
      {
        handlerName: 'getSongMeta',
        key: 'bangdream.song.meta',
        name: '查询分数表',
      },
      {
        handlerName: 'searchCard',
        key: 'bangdream.card.search',
        name: '查卡',
      },
      {
        handlerName: 'getCardIllustration',
        key: 'bangdream.card.illustration',
        name: '查卡面',
      },
      {
        handlerName: 'searchCharacter',
        key: 'bangdream.character.search',
        name: '查角色',
      },
      {
        handlerName: 'searchEvent',
        key: 'bangdream.event.search',
        name: '查活动',
      },
      {
        handlerName: 'getEventStage',
        key: 'bangdream.event.stage',
        name: '查试炼',
      },
      {
        handlerName: 'searchPlayer',
        key: 'bangdream.player.search',
        name: '查玩家',
      },
      {
        handlerName: 'searchGacha',
        key: 'bangdream.gacha.search',
        name: '查卡池',
      },
      {
        handlerName: 'simulateGacha',
        key: 'bangdream.gacha.simulate',
        name: '抽卡模拟',
      },
      {
        handlerName: 'getCutoffDetail',
        key: 'bangdream.cutoff.detail',
        name: 'ycx',
      },
      {
        handlerName: 'getCutoffAll',
        key: 'bangdream.cutoff.all',
        name: 'ycxall',
      },
      {
        handlerName: 'getCutoffRecent',
        key: 'bangdream.cutoff.recent',
        name: 'lsycx',
      },
    ]);
    expect(
      existsSync(
        join(pluginRoot, 'bangdream/src/registry/operation-registry.ts'),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          pluginRoot,
          'bangdream/src/commands/qqbot-bangdream-command.definitions.ts',
        ),
      ),
    ).toBe(false);
  });

  it('routes FF14 Market and FFLogs HTTP through the plugin platform SDK', () => {
    const externalHttpSources = ['ff14-market', 'fflogs'].flatMap(
      (pluginName) =>
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
