export const BANGDREAM_DEGREE_LIST_SPEC = {
  badge: {
    decoratedMinDegreeIdExclusive: 12,
    height: 50,
    normalType: 'normal',
    tryClearType: 'try_clear',
    width: 230,
  },
  eventRewards: {
    degreeRewardType: 'degree',
    liveTryResourceType: 'degree',
    maxDegreeCount: 6,
    musicRankingEventTypes: ['versus', 'challenge', 'medley'],
    stopAfterFirstMusicGroupEventType: 'medley',
  },
  list: {
    textSize: 50,
  },
} as const;

/**
 * 判断称号是否需要绘制框或图标叠层。
 *
 * @param options - BangDream列表；计算 BangDream判断结果。
 */
export function shouldDrawDegreeDecorations({
  degreeId,
  degreeType,
}: {
  degreeId: number;
  degreeType: string | null;
}) {
  return (
    degreeType != null &&
    degreeType !== BANGDREAM_DEGREE_LIST_SPEC.badge.normalType &&
    degreeId > BANGDREAM_DEGREE_LIST_SPEC.badge.decoratedMinDegreeIdExclusive
  );
}

/**
 * 判断称号叠层是否需要绘制左侧图标。
 *
 * @param degreeType - degreeType 输入；计算 BangDream判断结果。
 */
export function shouldDrawDegreeIcon(degreeType: string | null) {
  return degreeType !== BANGDREAM_DEGREE_LIST_SPEC.badge.tryClearType;
}

/**
 * 判断活动类型是否包含歌曲排名称号奖励。
 *
 * @param eventType - eventType 输入；驱动 `musicRankingEventTypes.includes()` 的 BangDream步骤。
 */
export function shouldCollectMusicRankingDegreeRewards(eventType: string) {
  return BANGDREAM_DEGREE_LIST_SPEC.eventRewards.musicRankingEventTypes.includes(
    eventType as (typeof BANGDREAM_DEGREE_LIST_SPEC.eventRewards.musicRankingEventTypes)[number],
  );
}

/**
 * 判断歌曲奖励列表是否只读取第一组。
 *
 * @param eventType - eventType 输入；计算 BangDream判断结果。
 */
export function shouldStopAfterFirstMusicRewardGroup(eventType: string) {
  return (
    eventType ===
    BANGDREAM_DEGREE_LIST_SPEC.eventRewards.stopAfterFirstMusicGroupEventType
  );
}

/**
 * 判断奖励类型是否为称号。
 *
 * @param rewardType - rewardType 输入；计算 BangDream判断结果。
 */
export function isDegreeRewardType(rewardType: string | null | undefined) {
  return (
    rewardType === BANGDREAM_DEGREE_LIST_SPEC.eventRewards.degreeRewardType
  );
}
