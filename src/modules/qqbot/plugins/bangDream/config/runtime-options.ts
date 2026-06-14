import {
  BANGDREAM_SERVER_ID_BY_CODE,
  BangDreamCardType,
  BangDreamEventStageType,
  BangDreamServerCode,
} from '@/modules/qqbot/plugins/bangDream/shared/bangdream-protocol';

export const BANGDREAM_TSUGU_ENV_KEYS = {
  bestdoriBaseUrl: 'BANGDREAM_TSUGU_BESTDORI_BASE_URL',
  cacheRoot: 'BANGDREAM_TSUGU_CACHE_ROOT',
  compress: 'BANGDREAM_TSUGU_COMPRESS',
  displayedServers: 'BANGDREAM_TSUGU_DISPLAYED_SERVERS',
  hhwxBaseUrl: 'BANGDREAM_TSUGU_HHWX_BASE_URL',
  mainDataReadyTimeoutMs: 'BANGDREAM_TSUGU_MAIN_DATA_READY_TIMEOUT_MS',
  mainServer: 'BANGDREAM_TSUGU_MAIN_SERVER',
  requestTimeoutMs: 'BANGDREAM_TSUGU_REQUEST_TIMEOUT_MS',
  retryCount: 'BANGDREAM_TSUGU_RETRY_COUNT',
  useEasyBg: 'BANGDREAM_TSUGU_USE_EASY_BG',
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

export const BANGDREAM_EVENT_STAGE_STROKE_COLOR = {
  [BangDreamEventStageType.judge]: '#b48335',
  [BangDreamEventStageType.combo]: '#bc5e19',
  [BangDreamEventStageType.life]: '#549b20',
  [BangDreamEventStageType.unknown]: '#757575',
} as const;

export const BANGDREAM_CARD_PRIORITY_TYPES = [
  BangDreamCardType.kirafes,
  BangDreamCardType.dreamfes,
  BangDreamCardType.limited,
  BangDreamCardType.birthday,
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
  a: 3,
  b: 2,
  c: 1,
  d: 0,
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

export function normalizeBangDreamPositiveInteger(
  value: unknown,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function normalizeBangDreamBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on', '是', '开启'].includes(
    `${value}`.trim().toLowerCase(),
  );
}

export function splitBangDreamOptionList(source: unknown) {
  if (Array.isArray(source)) {
    return source.map((item) => `${item}`.trim()).filter(Boolean);
  }
  return `${source || ''}`.split(/[\s,，]+/).filter(Boolean);
}
