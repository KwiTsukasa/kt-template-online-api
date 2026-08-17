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
 * 根据当前运行态与当前约束判定称号是否需要绘制框或图标叠层。
 * @returns 满足称号是否需要绘制框或图标叠层约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
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
 * 根据`degreeType`与当前约束判定称号叠层是否需要绘制左侧图标。
 * @param degreeType - 决定称号叠层是否需要绘制左侧图标内容、边界或目标的 `degreeType` 值。
 * @returns 满足称号叠层是否需要绘制左侧图标约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function shouldDrawDegreeIcon(degreeType: string | null) {
  return degreeType !== BANGDREAM_DEGREE_LIST_SPEC.badge.tryClearType;
}

/**
 * 根据`eventType`与当前约束判定活动类型是否包含歌曲排名称号奖励。
 * @param eventType - 决定活动类型是否包含歌曲排名称号奖励内容、边界或目标的 `eventType` 值。
 * @returns 满足活动类型是否包含歌曲排名称号奖励约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function shouldCollectMusicRankingDegreeRewards(eventType: string) {
  return BANGDREAM_DEGREE_LIST_SPEC.eventRewards.musicRankingEventTypes.includes(
    eventType as (typeof BANGDREAM_DEGREE_LIST_SPEC.eventRewards.musicRankingEventTypes)[number],
  );
}

/**
 * 根据`eventType`与当前约束判定歌曲奖励列表是否只读取第一组。
 * @param eventType - 决定歌曲奖励列表是否只读取第一组内容、边界或目标的 `eventType` 值。
 * @returns 满足歌曲奖励列表是否只读取第一组约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function shouldStopAfterFirstMusicRewardGroup(eventType: string) {
  return (
    eventType ===
    BANGDREAM_DEGREE_LIST_SPEC.eventRewards.stopAfterFirstMusicGroupEventType
  );
}

/**
 * 根据`rewardType`与当前约束判定奖励类型是否为称号。
 * @param rewardType - 决定奖励类型是否为称号内容、边界或目标的 `rewardType` 值。
 * @returns 满足奖励类型是否为称号约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isDegreeRewardType(rewardType: string | null | undefined) {
  return (
    rewardType === BANGDREAM_DEGREE_LIST_SPEC.eventRewards.degreeRewardType
  );
}
