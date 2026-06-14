export type QqbotBangDreamOperationHandlerName =
  | 'getCardIllustration'
  | 'getCutoffAll'
  | 'getCutoffDetail'
  | 'getCutoffRecent'
  | 'getEventStage'
  | 'getSongChart'
  | 'getSongMeta'
  | 'randomSong'
  | 'searchCard'
  | 'searchCharacter'
  | 'searchEvent'
  | 'searchGacha'
  | 'searchPlayer'
  | 'searchSong'
  | 'simulateGacha';

export type TsuguOperationDefinition = {
  description: string;
  handlerName: QqbotBangDreamOperationHandlerName;
  key: string;
  name: string;
  onlineCommand: {
    aliases: readonly string[];
    cooldownMs: number;
    remark: string;
  };
};

export const BANGDREAM_OPERATION_REGISTRY = [
  {
    description: '按歌曲名、昵称、标签或歌曲 ID 查询歌曲信息图片。',
    handlerName: 'searchSong',
    key: 'bangdream.song.search',
    name: '查曲',
    onlineCommand: {
      aliases: ['查曲', 'bd', 'bangdream', 'bandori', '邦邦', '邦邦查歌'],
      cooldownMs: 1500,
      remark: '查询 BanG Dream 歌曲信息；格式：/查曲 歌曲名 或 /查曲 歌曲ID',
    },
  },
  {
    description: '按歌曲 ID 和难度查询谱面图片。',
    handlerName: 'getSongChart',
    key: 'bangdream.song.chart',
    name: '查谱面',
    onlineCommand: {
      aliases: ['查谱面', '谱面', 'bd谱面'],
      cooldownMs: 1500,
      remark: '查询歌曲谱面；格式：/查谱面 歌曲ID [难度]',
    },
  },
  {
    description: '按关键词随机抽取一首歌曲并输出歌曲图片。',
    handlerName: 'randomSong',
    key: 'bangdream.song.random',
    name: '随机曲',
    onlineCommand: {
      aliases: ['随机曲', '随机', 'bd随机'],
      cooldownMs: 1500,
      remark: '按关键词随机歌曲；格式：/随机曲 [关键词]',
    },
  },
  {
    description: '查询指定服务器歌曲分数榜图片。',
    handlerName: 'getSongMeta',
    key: 'bangdream.song.meta',
    name: '查询分数表',
    onlineCommand: {
      aliases: ['查询分数表', '查分数表', '查询分数榜', '查分数榜', 'bd分数表'],
      cooldownMs: 1500,
      remark: '查询歌曲分数榜；格式：/查询分数表 [服务器]',
    },
  },
  {
    description: '按卡牌关键词或卡牌 ID 查询卡牌信息图片。',
    handlerName: 'searchCard',
    key: 'bangdream.card.search',
    name: '查卡',
    onlineCommand: {
      aliases: ['查卡', '查卡牌', 'bd查卡'],
      cooldownMs: 1500,
      remark: '查询卡牌信息；格式：/查卡 卡牌关键词 或 /查卡 卡牌ID',
    },
  },
  {
    description: '按卡牌 ID 查询卡面插画图片。',
    handlerName: 'getCardIllustration',
    key: 'bangdream.card.illustration',
    name: '查卡面',
    onlineCommand: {
      aliases: ['查卡面', '查卡插画', '查插画', 'bd卡面'],
      cooldownMs: 1500,
      remark: '查询卡牌插画；格式：/查卡面 卡牌ID',
    },
  },
  {
    description: '按角色关键词或角色 ID 查询角色信息图片。',
    handlerName: 'searchCharacter',
    key: 'bangdream.character.search',
    name: '查角色',
    onlineCommand: {
      aliases: ['查角色', 'bd角色'],
      cooldownMs: 1500,
      remark: '查询角色信息；格式：/查角色 角色关键词 或 /查角色 角色ID',
    },
  },
  {
    description: '按活动关键词或活动 ID 查询活动信息图片。',
    handlerName: 'searchEvent',
    key: 'bangdream.event.search',
    name: '查活动',
    onlineCommand: {
      aliases: ['查活动', 'bd活动'],
      cooldownMs: 1500,
      remark: '查询活动信息；格式：/查活动 活动关键词 或 /查活动 活动ID',
    },
  },
  {
    description: '查询当前或指定活动的试炼信息图片。',
    handlerName: 'getEventStage',
    key: 'bangdream.event.stage',
    name: '查试炼',
    onlineCommand: {
      aliases: ['查试炼', '查stage', '查舞台', '查festival', '查5v5'],
      cooldownMs: 1500,
      remark: '查询活动试炼；格式：/查试炼 [活动ID] [-m]',
    },
  },
  {
    description: '按玩家 ID 和服务器查询玩家信息图片。',
    handlerName: 'searchPlayer',
    key: 'bangdream.player.search',
    name: '查玩家',
    onlineCommand: {
      aliases: ['查玩家', '查询玩家', 'bd玩家'],
      cooldownMs: 1500,
      remark: '查询玩家信息；格式：/查玩家 玩家ID [服务器]',
    },
  },
  {
    description: '按卡池 ID 查询卡池信息图片。',
    handlerName: 'searchGacha',
    key: 'bangdream.gacha.search',
    name: '查卡池',
    onlineCommand: {
      aliases: ['查卡池', 'bd卡池'],
      cooldownMs: 1500,
      remark: '查询卡池信息；格式：/查卡池 卡池ID',
    },
  },
  {
    description: '模拟指定次数抽卡并输出结果图片。',
    handlerName: 'simulateGacha',
    key: 'bangdream.gacha.simulate',
    name: '抽卡模拟',
    onlineCommand: {
      aliases: ['抽卡模拟', 'bd抽卡'],
      cooldownMs: 3000,
      remark: '模拟抽卡；格式：/抽卡模拟 [次数] [卡池ID]',
    },
  },
  {
    description: '查询指定档位的当前活动档线与预测线图片。',
    handlerName: 'getCutoffDetail',
    key: 'bangdream.cutoff.detail',
    name: 'ycx',
    onlineCommand: {
      aliases: ['ycx', '预测线', '查档线', 'bd档线'],
      cooldownMs: 3000,
      remark: '查询指定档位预测线；格式：/ycx 档位 [活动ID] [服务器]',
    },
  },
  {
    description: '查询当前活动所有档位的档线与预测线图片。',
    handlerName: 'getCutoffAll',
    key: 'bangdream.cutoff.all',
    name: 'ycxall',
    onlineCommand: {
      aliases: ['ycxall', 'myycx', '全部档线'],
      cooldownMs: 3000,
      remark: '查询所有档位预测线；格式：/ycxall [活动ID] [服务器]',
    },
  },
  {
    description: '查询指定档位与最近同类型活动档线图片。',
    handlerName: 'getCutoffRecent',
    key: 'bangdream.cutoff.recent',
    name: 'lsycx',
    onlineCommand: {
      aliases: ['lsycx', '历史档线', '近期档线'],
      cooldownMs: 3000,
      remark: '查询同类型活动档线；格式：/lsycx 档位 [活动ID] [服务器]',
    },
  },
] as const satisfies readonly TsuguOperationDefinition[];

export type QqbotBangDreamOperationKey =
  (typeof BANGDREAM_OPERATION_REGISTRY)[number]['key'];

export type TsuguOperationRegistryItem =
  (typeof BANGDREAM_OPERATION_REGISTRY)[number];

export const BANGDREAM_OPERATION_KEYS = BANGDREAM_OPERATION_REGISTRY.map(
  (operation) => operation.key,
);

const BANGDREAM_OPERATION_BY_KEY = new Map<string, TsuguOperationRegistryItem>(
  BANGDREAM_OPERATION_REGISTRY.map((operation) => [operation.key, operation]),
);

/**
 * 按 operation key 查找 BangDream Tsugu 命令定义。
 *
 * @param operationKey - BangDream operation key。
 */
export function getBangDreamOperationDefinition(operationKey: string) {
  return BANGDREAM_OPERATION_BY_KEY.get(operationKey);
}
