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

export enum BangDreamSongTag {
  normal = 'normal',
  anime = 'anime',
  tieUp = 'tie_up',
}

export enum BangDreamEventStatus {
  notStart = 'not_start',
  inProgress = 'in_progress',
  ended = 'ended',
}

export enum BangDreamEventType {
  story = 'story',
  versus = 'versus',
  liveTry = 'live_try',
  challenge = 'challenge',
  missionLive = 'mission_live',
  festival = 'festival',
  medley = 'medley',
}

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

export const BANGDREAM_ITEM_TYPE_PREFIXES = [
  ['item_', 'material'],
  ['live_boost_recovery_item_', 'boostdrink'],
  ['practice_ticket_', 'practiceTicket'],
  ['skill_practice', 'skillticket'],
  ['gacha_ticket_', 'gachaTicket'],
  ['miracle_ticket_', 'miracleTicket'],
] as const;

export const BANGDREAM_BESTDORI_API_PATHS = {
  areaItems: '/api/areaItems/main.5.json',
  bands: '/api/bands/main.1.json',
  cards: '/api/cards/all.5.json',
  characters: '/api/characters/main.3.json',
  comics: '/api/comics/all.5.json',
  costumes: '/api/costumes/all.5.json',
  deco: '/api/deco/pins.all.3.json',
  degrees: '/api/degrees/all.3.json',
  events: '/api/events/all.6.json',
  gacha: '/api/gacha/all.5.json',
  items: '/api/misc/itemtexts.2.json',
  loginCampaigns: '/api/loginCampaigns/all.5.json',
  meta: '/api/songs/meta/all.5.json',
  miracleTicketExchanges: '/api/miracleTicketExchanges/all.5.json',
  rates: '/api/tracker/rates.json',
  singer: '/api/bands/all.1.json',
  skills: '/api/skills/all.10.json',
  songs: '/api/songs/all.7.json',
} as const;
