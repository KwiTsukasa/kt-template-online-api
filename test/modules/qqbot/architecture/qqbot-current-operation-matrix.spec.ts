import { readFileSync } from 'fs';
import { join } from 'path';

import { parseQqbotPluginManifest } from '../../../../src/modules/qqbot/plugin-platform/domain/manifest';

const repoRoot = join(__dirname, '../../../..');
const pluginRoot = join(repoRoot, 'src/modules/qqbot/plugins');

type ExpectedOperation = {
  aliases: string[];
  handlerName: string;
  key: string;
  name: string;
};

const readJson = (filePath: string) =>
  JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;

const readManifest = (pluginDir: string) =>
  parseQqbotPluginManifest(
    readJson(join(pluginRoot, pluginDir, 'plugin.json')),
    {
      pluginRoot: join(pluginRoot, pluginDir),
    },
  );

const bangdreamOperations: ExpectedOperation[] = [
  {
    aliases: ['查曲', 'bd', 'bangdream', 'bandori', '邦邦', '邦邦查歌'],
    handlerName: 'searchSong',
    key: 'bangdream.song.search',
    name: '查曲',
  },
  {
    aliases: ['查谱面', '谱面', 'bd谱面'],
    handlerName: 'getSongChart',
    key: 'bangdream.song.chart',
    name: '查谱面',
  },
  {
    aliases: ['随机曲', '随机', 'bd随机'],
    handlerName: 'randomSong',
    key: 'bangdream.song.random',
    name: '随机曲',
  },
  {
    aliases: ['查询分数表', '查分数表', '查询分数榜', '查分数榜', 'bd分数表'],
    handlerName: 'getSongMeta',
    key: 'bangdream.song.meta',
    name: '查询分数表',
  },
  {
    aliases: ['查卡', '查卡牌', 'bd查卡'],
    handlerName: 'searchCard',
    key: 'bangdream.card.search',
    name: '查卡',
  },
  {
    aliases: ['查卡面', '查卡插画', '查插画', 'bd卡面'],
    handlerName: 'getCardIllustration',
    key: 'bangdream.card.illustration',
    name: '查卡面',
  },
  {
    aliases: ['查角色', 'bd角色'],
    handlerName: 'searchCharacter',
    key: 'bangdream.character.search',
    name: '查角色',
  },
  {
    aliases: ['查活动', 'bd活动'],
    handlerName: 'searchEvent',
    key: 'bangdream.event.search',
    name: '查活动',
  },
  {
    aliases: ['查试炼', '查stage', '查舞台', '查festival', '查5v5'],
    handlerName: 'getEventStage',
    key: 'bangdream.event.stage',
    name: '查试炼',
  },
  {
    aliases: ['查玩家', '查询玩家', 'bd玩家'],
    handlerName: 'searchPlayer',
    key: 'bangdream.player.search',
    name: '查玩家',
  },
  {
    aliases: ['查卡池', 'bd卡池'],
    handlerName: 'searchGacha',
    key: 'bangdream.gacha.search',
    name: '查卡池',
  },
  {
    aliases: ['抽卡模拟', 'bd抽卡'],
    handlerName: 'simulateGacha',
    key: 'bangdream.gacha.simulate',
    name: '抽卡模拟',
  },
  {
    aliases: ['ycx', '预测线', '查档线', 'bd档线'],
    handlerName: 'getCutoffDetail',
    key: 'bangdream.cutoff.detail',
    name: 'ycx',
  },
  {
    aliases: ['ycxall', 'myycx', '全部档线'],
    handlerName: 'getCutoffAll',
    key: 'bangdream.cutoff.all',
    name: 'ycxall',
  },
  {
    aliases: ['lsycx', '历史档线', '近期档线'],
    handlerName: 'getCutoffRecent',
    key: 'bangdream.cutoff.recent',
    name: 'lsycx',
  },
];

describe('QQBot current operation matrix', () => {
  it('freezes the current BangDream operation matrix from the manifest', () => {
    const manifest = readManifest('bangdream');

    expect(
      manifest.operations.map((operation) => ({
        aliases: operation.aliases,
        handlerName: operation.handlerName,
        key: operation.key,
        name: operation.name,
      })),
    ).toEqual(bangdreamOperations);
  });

  it('freezes built-in plugin manifests and exposed capabilities', () => {
    const manifests = {
      bangdream: readManifest('bangdream'),
      ff14: readManifest('ff14-market'),
      fflogs: readManifest('fflogs'),
      repeater: readManifest('repeater'),
    };

    expect(manifests.bangdream.pluginKey).toBe('bangdream');
    expect(
      manifests.bangdream.operations.map((operation) => ({
        aliases: operation.aliases,
        handlerName: operation.handlerName,
        key: operation.key,
        name: operation.name,
      })),
    ).toEqual(bangdreamOperations);

    expect(
      manifests.ff14.operations.map((operation) => ({
        aliases: operation.aliases,
        handlerName: operation.handlerName,
        key: operation.key,
        name: operation.name,
      })),
    ).toEqual([
      {
        aliases: ['物品', 'item', 'ff14item'],
        handlerName: 'resolveItem',
        key: 'ff14.item.resolve',
        name: '解析物品',
      },
      {
        aliases: ['查价', 'price', 'ff14price'],
        handlerName: 'getPrice',
        key: 'ff14.market.price',
        name: '市场查价',
      },
    ]);

    expect(
      manifests.fflogs.operations.map((operation) => ({
        aliases: operation.aliases,
        handlerName: operation.handlerName,
        key: operation.key,
        name: operation.name,
      })),
    ).toEqual([
      {
        aliases: ['fflogs', 'logs', '查logs', '查log'],
        handlerName: 'getCharacterSummary',
        key: 'fflogs.character.summary',
        name: '角色排名摘要',
      },
    ]);

    expect(manifests.repeater.operations).toEqual([]);
    expect(
      manifests.repeater.events.map((event) => ({
        eventName: event.eventName,
        handlerName: event.handlerName,
        key: event.key,
        name: event.name,
      })),
    ).toEqual([
      {
        eventName: 'message',
        handlerName: 'handleMessage',
        key: 'repeater.message',
        name: '消息事件',
      },
    ]);
  });

  it('freezes current online command seed linkage for command plugins', () => {
    const seedSql = readFileSync(join(repoRoot, 'sql/qqbot-init.sql'), 'utf8');

    for (const operation of bangdreamOperations) {
      expect(seedSql).toContain(`'${operation.key}'`);
      expect(seedSql).toContain(JSON.stringify(operation.aliases));
    }

    expect(seedSql).toContain(`'ff14-market', 'ff14.market.price'`);
    expect(seedSql).toContain(`'fflogs', 'fflogs.character.summary'`);
    expect(seedSql).toContain(
      `'bangdream', 'bangdream.event.stage', 'plain'`,
    );
  });
});
