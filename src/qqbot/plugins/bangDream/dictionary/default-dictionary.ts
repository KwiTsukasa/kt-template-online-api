import {
  BangDreamCardType,
  BangDreamDifficultyId,
  BangDreamEventStageType,
  BangDreamEventStatus,
  BangDreamEventType,
  BangDreamGachaType,
  BangDreamServerCode,
  BangDreamSongTag,
} from '@/qqbot/plugins/bangDream/shared/bangdream-protocol';

export const BANGDREAM_DICTIONARY_CODES = {
  difficultyAlias: 'BANGDREAM_DIFFICULTY_ALIAS',
  serverAlias: 'BANGDREAM_SERVER_ALIAS',
} as const;

export const BANGDREAM_SERVER_LABELS = [
  '日服',
  '国际服',
  '台服',
  '国服',
  '韩服',
] as const;

export const BANGDREAM_DEFAULT_SERVER_ALIASES = {
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

export const BANGDREAM_SERVER_ALIASES = BANGDREAM_DEFAULT_SERVER_ALIASES;

export const BANGDREAM_DEFAULT_DIFFICULTY_ALIASES = {
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

export const BANGDREAM_DIFFICULTY_ALIASES =
  BANGDREAM_DEFAULT_DIFFICULTY_ALIASES;

export const BANGDREAM_SONG_TAG_NAME = {
  [BangDreamSongTag.normal]: '原创曲',
  [BangDreamSongTag.anime]: '翻唱曲',
  [BangDreamSongTag.tieUp]: 'EXTRA歌曲',
} as const;

export const BANGDREAM_EVENT_STATUS_NAME = {
  [BangDreamEventStatus.notStart]: '未开始',
  [BangDreamEventStatus.inProgress]: '进行中',
  [BangDreamEventStatus.ended]: '已结束',
} as const;

export const BANGDREAM_EVENT_TYPE_NAME = {
  [BangDreamEventType.story]: '一般活动 (协力)',
  [BangDreamEventType.versus]: '竞演LIVE (对邦)',
  [BangDreamEventType.liveTry]: 'LIVE试炼 (EX)',
  [BangDreamEventType.challenge]: '挑战LIVE (CP)',
  [BangDreamEventType.missionLive]: '任务LIVE (协力)',
  [BangDreamEventType.festival]: '团队LIVE FES (5v5)',
  [BangDreamEventType.medley]: '组曲LIVE (3组曲)',
} as const;

export const BANGDREAM_EVENT_STAGE_NAME = {
  [BangDreamEventStageType.judge]: '判定试炼',
  [BangDreamEventStageType.combo]: 'COMBO试炼',
  [BangDreamEventStageType.life]: 'LIFE试炼',
  [BangDreamEventStageType.unknown]: '未知类型试炼',
} as const;

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
