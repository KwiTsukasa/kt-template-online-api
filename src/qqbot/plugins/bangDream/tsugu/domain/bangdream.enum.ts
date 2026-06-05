export enum BangDreamServerCode {
  jp = 'jp',
  en = 'en',
  tw = 'tw',
  cn = 'cn',
  kr = 'kr',
}

export enum BangDreamServerId {
  jp = 0,
  en = 1,
  tw = 2,
  cn = 3,
  kr = 4,
}

export const BANGDREAM_SERVER_CODES = [
  BangDreamServerCode.jp,
  BangDreamServerCode.en,
  BangDreamServerCode.tw,
  BangDreamServerCode.cn,
  BangDreamServerCode.kr,
] as const;

export const BANGDREAM_SERVER_ID_BY_CODE = {
  [BangDreamServerCode.jp]: BangDreamServerId.jp,
  [BangDreamServerCode.en]: BangDreamServerId.en,
  [BangDreamServerCode.tw]: BangDreamServerId.tw,
  [BangDreamServerCode.cn]: BangDreamServerId.cn,
  [BangDreamServerCode.kr]: BangDreamServerId.kr,
} as const;

export const BANGDREAM_SERVER_LABELS = [
  '日服',
  '国际服',
  '台服',
  '国服',
  '韩服',
] as const;

export const BANGDREAM_SERVER_ALIASES = {
  cn: BangDreamServerCode.cn,
  en: BangDreamServerCode.en,
  jp: BangDreamServerCode.jp,
  kr: BangDreamServerCode.kr,
  tw: BangDreamServerCode.tw,
  中国: BangDreamServerCode.cn,
  中服: BangDreamServerCode.cn,
  国服: BangDreamServerCode.cn,
  国际服: BangDreamServerCode.en,
  日服: BangDreamServerCode.jp,
  韩服: BangDreamServerCode.kr,
  台服: BangDreamServerCode.tw,
} as const;

export const BANGDREAM_DEFAULT_SERVER_CODES = [
  BangDreamServerCode.cn,
  BangDreamServerCode.jp,
] as const;

export const BANGDREAM_DEFAULT_SERVER_IDS = BANGDREAM_DEFAULT_SERVER_CODES.map(
  (serverCode) => BANGDREAM_SERVER_ID_BY_CODE[serverCode],
);

export const BANGDREAM_SERVER_PRIORITY_CODES = [
  BangDreamServerCode.cn,
  BangDreamServerCode.jp,
  BangDreamServerCode.tw,
  BangDreamServerCode.en,
  BangDreamServerCode.kr,
] as const;

export const BANGDREAM_SERVER_PRIORITY_IDS =
  BANGDREAM_SERVER_PRIORITY_CODES.map(
    (serverCode) => BANGDREAM_SERVER_ID_BY_CODE[serverCode],
  );

export enum BangDreamDifficultyId {
  easy = 0,
  normal = 1,
  hard = 2,
  expert = 3,
  special = 4,
}

export const BANGDREAM_DIFFICULTY_NAME_BY_ID = {
  [BangDreamDifficultyId.easy]: 'easy',
  [BangDreamDifficultyId.normal]: 'normal',
  [BangDreamDifficultyId.hard]: 'hard',
  [BangDreamDifficultyId.expert]: 'expert',
  [BangDreamDifficultyId.special]: 'special',
} as const;

export const BANGDREAM_DIFFICULTY_NAMES = [
  BANGDREAM_DIFFICULTY_NAME_BY_ID[BangDreamDifficultyId.easy],
  BANGDREAM_DIFFICULTY_NAME_BY_ID[BangDreamDifficultyId.normal],
  BANGDREAM_DIFFICULTY_NAME_BY_ID[BangDreamDifficultyId.hard],
  BANGDREAM_DIFFICULTY_NAME_BY_ID[BangDreamDifficultyId.expert],
  BANGDREAM_DIFFICULTY_NAME_BY_ID[BangDreamDifficultyId.special],
] as const;

export const BANGDREAM_DIFFICULTY_COLORS = [
  '#8eb4fd',
  '#a6f692',
  '#fbdf8c',
  '#ff898b',
  '#f383cb',
] as const;

export const BANGDREAM_DIFFICULTY_ALIASES = {
  easy: BangDreamDifficultyId.easy,
  ez: BangDreamDifficultyId.easy,
  normal: BangDreamDifficultyId.normal,
  nm: BangDreamDifficultyId.normal,
  hard: BangDreamDifficultyId.hard,
  hd: BangDreamDifficultyId.hard,
  expert: BangDreamDifficultyId.expert,
  ex: BangDreamDifficultyId.expert,
  special: BangDreamDifficultyId.special,
  sp: BangDreamDifficultyId.special,
  简单: BangDreamDifficultyId.easy,
  普通: BangDreamDifficultyId.normal,
  困难: BangDreamDifficultyId.hard,
  专家: BangDreamDifficultyId.expert,
  特殊: BangDreamDifficultyId.special,
} as const;

export enum BangDreamSongTag {
  normal = 'normal',
  anime = 'anime',
  tieUp = 'tie_up',
}

export const BANGDREAM_SONG_TAG_NAME = {
  [BangDreamSongTag.normal]: '原创曲',
  [BangDreamSongTag.anime]: '翻唱曲',
  [BangDreamSongTag.tieUp]: 'EXTRA歌曲',
} as const;

export enum BangDreamEventStatus {
  notStart = 'not_start',
  inProgress = 'in_progress',
  ended = 'ended',
}

export const BANGDREAM_EVENT_STATUS_NAME = {
  [BangDreamEventStatus.notStart]: '未开始',
  [BangDreamEventStatus.inProgress]: '进行中',
  [BangDreamEventStatus.ended]: '已结束',
} as const;

export enum BangDreamEventType {
  story = 'story',
  versus = 'versus',
  liveTry = 'live_try',
  challenge = 'challenge',
  missionLive = 'mission_live',
  festival = 'festival',
  medley = 'medley',
}

export const BANGDREAM_EVENT_TYPE_NAME = {
  [BangDreamEventType.story]: '一般活动 (协力)',
  [BangDreamEventType.versus]: '竞演LIVE (对邦)',
  [BangDreamEventType.liveTry]: 'LIVE试炼 (EX)',
  [BangDreamEventType.challenge]: '挑战LIVE (CP)',
  [BangDreamEventType.missionLive]: '任务LIVE (协力)',
  [BangDreamEventType.festival]: '团队LIVE FES (5v5)',
  [BangDreamEventType.medley]: '组曲LIVE (3组曲)',
} as const;

export enum BangDreamEventStageType {
  judge = 'judge',
  combo = 'combo',
  life = 'life',
  unknown = 'undefined',
}

export const BANGDREAM_EVENT_STAGE_TYPES = [
  BangDreamEventStageType.judge,
  BangDreamEventStageType.combo,
  BangDreamEventStageType.life,
] as const;

export const BANGDREAM_EVENT_STAGE_STROKE_COLOR = {
  [BangDreamEventStageType.judge]: '#b48335',
  [BangDreamEventStageType.combo]: '#bc5e19',
  [BangDreamEventStageType.life]: '#549b20',
  [BangDreamEventStageType.unknown]: '#757575',
} as const;

export const BANGDREAM_EVENT_STAGE_NAME = {
  [BangDreamEventStageType.judge]: '判定试炼',
  [BangDreamEventStageType.combo]: 'COMBO试炼',
  [BangDreamEventStageType.life]: 'LIFE试炼',
  [BangDreamEventStageType.unknown]: '未知类型试炼',
} as const;

export enum BangDreamCardType {
  initial = 'initial',
  permanent = 'permanent',
  limited = 'limited',
  birthday = 'birthday',
  event = 'event',
  others = 'others',
  campaign = 'campaign',
  dreamfes = 'dreamfes',
  kirafes = 'kirafes',
}

export const BANGDREAM_CARD_TYPE_NAME = {
  [BangDreamCardType.initial]: '初始',
  [BangDreamCardType.permanent]: '常驻',
  [BangDreamCardType.limited]: '期间限定',
  [BangDreamCardType.birthday]: '生日限定',
  [BangDreamCardType.event]: '活动',
  [BangDreamCardType.others]: '其他',
  [BangDreamCardType.campaign]: '联动',
  [BangDreamCardType.dreamfes]: '梦幻Fes限定',
  [BangDreamCardType.kirafes]: '闪光Fes限定',
} as const;

export const BANGDREAM_CARD_PRIORITY_TYPES = [
  BangDreamCardType.kirafes,
  BangDreamCardType.dreamfes,
  BangDreamCardType.limited,
  BangDreamCardType.birthday,
] as const;

export enum BangDreamGachaType {
  permanent = 'permanent',
  special = 'special',
  birthday = 'birthday',
  free = 'free',
  dreamfes = 'dreamfes',
  kirafes = 'kirafes',
  limited = 'limited',
  miracle = 'miracle',
}

export const BANGDREAM_GACHA_TYPE_NAME = {
  [BangDreamGachaType.permanent]: '常驻',
  [BangDreamGachaType.special]: '特殊',
  [BangDreamGachaType.birthday]: '生日限定',
  [BangDreamGachaType.free]: '免费',
  [BangDreamGachaType.dreamfes]: '梦幻Fes限定',
  [BangDreamGachaType.kirafes]: '闪光Fes限定',
  [BangDreamGachaType.limited]: '期间限定',
  [BangDreamGachaType.miracle]: '奇迹兑换券',
} as const;

export const BANGDREAM_ITEM_TYPE_PREFIXES = [
  ['item_', 'material'],
  ['live_boost_recovery_item_', 'boostdrink'],
  ['practice_ticket_', 'practiceTicket'],
  ['skill_practice', 'skillticket'],
  ['gacha_ticket_', 'gachaTicket'],
  ['miracle_ticket_', 'miracleTicket'],
] as const;

export const BANGDREAM_TIER_LIST_BY_SERVER = {
  [BangDreamServerCode.jp]: [
    20, 30, 40, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000, 10000, 20000,
    30000, 50000,
  ],
  [BangDreamServerCode.tw]: [100, 500],
  [BangDreamServerCode.en]: [50, 100, 300, 500, 1000, 2000, 2500],
  [BangDreamServerCode.kr]: [100],
  [BangDreamServerCode.cn]: [
    20, 30, 40, 50, 100, 200, 300, 400, 500, 1000, 1500, 2000, 3000, 4000, 5000,
    10000, 20000, 30000, 50000,
  ],
} as const;

export const BANGDREAM_STAGE_CHALLENGE_BAND_ID: Record<string, number> = {
  1: 1,
  2: 2,
  3: 5,
  4: 3,
  5: 4,
  18: 7,
  21: 6,
};

export const BANGDREAM_DECK_TOTAL_RATING_ID: Record<string, number> = {
  d: 0,
  c: 1,
  b: 2,
  a: 3,
  s: 4,
  ss: 5,
  sss: 6,
};

export const BANGDREAM_STAT_CONFIG = {
  performance: { color: '#f76da1', name: '演出' },
  technique: { color: '#4fb9eb', name: '技巧' },
  visual: { color: '#fbc74f', name: '形象' },
} as const;

export const BANGDREAM_CN_ESTIMATE_START_EVENT_ID = 298;
export const BANGDREAM_CN_BLOCKED_EVENT_IDS: readonly number[] = [];
export const BANGDREAM_DEFAULT_NO_BANG_DAYS = 1;
