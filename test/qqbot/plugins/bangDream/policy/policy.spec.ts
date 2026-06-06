jest.mock('@/qqbot/plugins/bangDream/shared/main-data-store', () => ({
  __esModule: true,
  default: {},
}));

import {
  calculateCnEventEstimateStartAt,
  getBangDreamOccupiedDays,
  type BangDreamEventSchedule,
} from '@/qqbot/plugins/bangDream/policy/cn-event-estimate.policy';
import {
  getCutoffDateByServerTimezone,
  getCutoffDayIndex,
  getCutoffEventStatus,
  getCutoffPredictionWindow,
  getCutoffTierList,
  isCutoffDailyCheckpoint,
  isCutoffTierSupported,
  selectRecentCutoffEventIds,
} from '@/qqbot/plugins/bangDream/policy/cutoff.policy';
import {
  getBangDreamServerUtcOffset,
  normalizeBangDreamTimestamp,
} from '@/qqbot/plugins/bangDream/policy/server.policy';
import {
  applyGachaGuaranteedRarity,
  BANGDREAM_GACHA_MAX_SPIN_COUNT,
  isBirthdayGachaType,
  isFreeGachaType,
  isGachaSpinCountTooLarge,
  isPermanentJapaneseGachaPeriod,
  pickGachaCardIdByWeight,
  pickGachaRarityByRate,
} from '@/qqbot/plugins/bangDream/policy/gacha.policy';
import {
  BangDreamEventStatus,
  BangDreamGachaType,
  BangDreamServerId as Server,
} from '@/qqbot/plugins/bangDream/shared/bangdream-protocol';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('BangDream server policy', () => {
  it('normalizes timestamps and applies server UTC offsets', () => {
    expect(normalizeBangDreamTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeBangDreamTimestamp(1_700_000_000_000)).toBe(
      1_700_000_000_000,
    );
    expect(getBangDreamServerUtcOffset(Server.cn)).toBe(8);
    expect(getBangDreamServerUtcOffset(Server.jp)).toBe(9);
    expect(getBangDreamServerUtcOffset(Server.en)).toBe(0);
  });
});

describe('BangDream CN event estimate policy', () => {
  it('keeps occupied day calculation inclusive', () => {
    expect(
      getBangDreamOccupiedDays(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1)),
    ).toBe(1);
    expect(
      getBangDreamOccupiedDays(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 3)),
    ).toBe(3);
  });

  it('calculates the next missing CN event start from pure schedules', () => {
    const schedules: Record<number, BangDreamEventSchedule> = {
      100: {
        endAt: [Date.UTC(2026, 0, 5), null, null, Date.UTC(2026, 0, 5), null],
        startAt: [Date.UTC(2026, 0, 1), null, null, Date.UTC(2026, 0, 1), null],
      },
      101: {
        endAt: [Date.UTC(2026, 0, 10), null, null, null, null],
        startAt: [Date.UTC(2026, 0, 6), null, null, null, null],
      },
    };

    const result = calculateCnEventEstimateStartAt({
      currentEvent: { eventId: 100, ...schedules[100] },
      eventId: 101,
      getSchedule: (eventId) => schedules[eventId] || null,
      options: {
        defaultNoBangDays: 1,
        estimateStartEventId: 100,
      },
      presentJpEventId: 101,
    });

    expect(result).toBe(Date.UTC(2026, 0, 6));
  });
});

describe('BangDream cutoff policy', () => {
  it('checks tier support by server', () => {
    expect(getCutoffTierList(Server.cn)).toContain(1500);
    expect(isCutoffTierSupported(Server.cn, 1500)).toBe(true);
    expect(isCutoffTierSupported(Server.jp, 1500)).toBe(false);
  });

  it('resolves event status and prediction windows', () => {
    const startAt = Date.UTC(2026, 0, 1);
    const endAt = Date.UTC(2026, 0, 5);

    expect(getCutoffEventStatus(startAt, endAt, startAt - 1)).toBe(
      BangDreamEventStatus.notStart,
    );
    expect(getCutoffEventStatus(startAt, endAt, startAt + 1)).toBe(
      BangDreamEventStatus.inProgress,
    );
    expect(getCutoffEventStatus(startAt, endAt, endAt + 1)).toBe(
      BangDreamEventStatus.ended,
    );
    expect(getCutoffPredictionWindow(startAt, endAt)).toEqual({
      endTs: Math.floor(endAt / 1000),
      startTs: Math.floor(startAt / 1000),
    });
  });

  it('calculates daily checkpoints and event day index', () => {
    const checkpoint = getCutoffDateByServerTimezone(
      Date.UTC(2026, 0, 1, 18, 45),
      Server.jp,
    );
    expect(isCutoffDailyCheckpoint(Server.jp, checkpoint)).toBe(true);
    expect(isCutoffDailyCheckpoint(Server.en, checkpoint)).toBe(false);

    const eventStartAt = Date.UTC(2026, 0, 1, 12);
    expect(getCutoffDayIndex(Server.jp, eventStartAt, eventStartAt + 1)).toBe(
      0,
    );
    expect(
      getCutoffDayIndex(Server.jp, eventStartAt, eventStartAt + DAY_MS),
    ).toBe(1);
  });

  it('selects recent comparable events by type and server start time', () => {
    const candidates = [
      eventCandidate(1, 'story', [Date.UTC(2026, 0, 1)]),
      eventCandidate(2, 'festival', [Date.UTC(2026, 0, 5)]),
      eventCandidate(3, 'story', [Date.UTC(2026, 0, 10)]),
      eventCandidate(4, 'story', [Date.UTC(2026, 0, 15)]),
    ];

    expect(
      selectRecentCutoffEventIds({
        candidates,
        count: 2,
        event: candidates[3],
        sameType: true,
        server: Server.jp,
      }),
    ).toEqual([3, 4]);
  });
});

describe('BangDream gacha policy', () => {
  it('classifies gacha types and spin count limits', () => {
    expect(isBirthdayGachaType(BangDreamGachaType.birthday)).toBe(true);
    expect(isBirthdayGachaType(BangDreamGachaType.limited)).toBe(false);
    expect(isFreeGachaType(BangDreamGachaType.free)).toBe(true);
    expect(isPermanentJapaneseGachaPeriod('期限なし')).toBe(true);
    expect(isGachaSpinCountTooLarge(BANGDREAM_GACHA_MAX_SPIN_COUNT)).toBe(
      false,
    );
    expect(isGachaSpinCountTooLarge(BANGDREAM_GACHA_MAX_SPIN_COUNT + 1)).toBe(
      true,
    );
  });

  it('applies ten-pull guaranteed rarity without changing other pulls', () => {
    expect(applyGachaGuaranteedRarity(8, 2)).toBe(2);
    expect(applyGachaGuaranteedRarity(9, 2)).toBe(3);
    expect(applyGachaGuaranteedRarity(9, 4)).toBe(4);
  });

  it('picks rarity by rate and cards by rarity weight', () => {
    expect(
      pickGachaRarityByRate(
        {
          2: { rate: 97, weightTotal: 100 },
          3: { rate: 3, weightTotal: 50 },
        },
        () => 0.98,
      ),
    ).toBe('3');

    expect(
      pickGachaCardIdByWeight(
        3,
        50,
        {
          100: { rarityIndex: 2, weight: 100 },
          200: { rarityIndex: 3, weight: 10 },
          201: { rarityIndex: 3, weight: 40 },
        },
        () => 0.5,
      ),
    ).toBe('201');
  });
});

function eventCandidate(
  eventId: number,
  eventType: string,
  jpStartAt: number[],
) {
  return {
    eventId,
    eventType,
    startAt: [
      jpStartAt[0],
      null,
      null,
      jpStartAt[Server.cn] ?? jpStartAt[0],
      null,
    ],
  };
}
