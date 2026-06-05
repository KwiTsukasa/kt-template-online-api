import type { QqbotBangDreamOperationKey } from '../qqbot-bangdream.types';

export const BANGDREAM_INPUT_SCHEMA = {
  properties: {
    args: { description: '命令参数数组', type: 'array' },
    query: { description: '查询关键词', type: 'string' },
    raw: { description: '命令原始参数', type: 'string' },
    text: { description: '命令原始文本', type: 'string' },
  },
  type: 'object',
};

export const BANGDREAM_OUTPUT_SCHEMA = {
  properties: {
    imageCount: { type: 'number' },
    operationKey: { type: 'string' },
    query: { type: 'string' },
    replyText: { type: 'string' },
    source: { type: 'string' },
  },
  type: 'object',
};

export const BANGDREAM_OPERATION_DEFS: Array<{
  description: string;
  key: QqbotBangDreamOperationKey;
  name: string;
}> = [
  {
    description: '按歌曲名、昵称、标签或歌曲 ID 查询歌曲信息图片。',
    key: 'bangdream.song.search',
    name: '查曲',
  },
  {
    description: '按歌曲 ID 和难度查询谱面图片。',
    key: 'bangdream.song.chart',
    name: '查谱面',
  },
  {
    description: '按关键词随机抽取一首歌曲并输出歌曲图片。',
    key: 'bangdream.song.random',
    name: '随机曲',
  },
  {
    description: '查询指定服务器歌曲分数榜图片。',
    key: 'bangdream.song.meta',
    name: '查询分数表',
  },
  {
    description: '按卡牌关键词或卡牌 ID 查询卡牌信息图片。',
    key: 'bangdream.card.search',
    name: '查卡',
  },
  {
    description: '按卡牌 ID 查询卡面插画图片。',
    key: 'bangdream.card.illustration',
    name: '查卡面',
  },
  {
    description: '按角色关键词或角色 ID 查询角色信息图片。',
    key: 'bangdream.character.search',
    name: '查角色',
  },
  {
    description: '按活动关键词或活动 ID 查询活动信息图片。',
    key: 'bangdream.event.search',
    name: '查活动',
  },
  {
    description: '查询当前或指定活动的试炼信息图片。',
    key: 'bangdream.event.stage',
    name: '查试炼',
  },
  {
    description: '按玩家 ID 和服务器查询玩家信息图片。',
    key: 'bangdream.player.search',
    name: '查玩家',
  },
  {
    description: '按卡池 ID 查询卡池信息图片。',
    key: 'bangdream.gacha.search',
    name: '查卡池',
  },
  {
    description: '模拟指定次数抽卡并输出结果图片。',
    key: 'bangdream.gacha.simulate',
    name: '抽卡模拟',
  },
  {
    description: '查询指定档位的当前活动档线与预测线图片。',
    key: 'bangdream.cutoff.detail',
    name: 'ycx',
  },
  {
    description: '查询当前活动所有档位的档线与预测线图片。',
    key: 'bangdream.cutoff.all',
    name: 'ycxall',
  },
  {
    description: '查询指定档位与最近同类型活动档线图片。',
    key: 'bangdream.cutoff.recent',
    name: 'lsycx',
  },
];
