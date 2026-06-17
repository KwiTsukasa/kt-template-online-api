export const BANGDREAM_GACHA_LIST_SPEC = {
  behaviorLabels: {
    fixed_4_star_once: '必中★4',
    fixed_5_star_once: '必中★5',
    normal: '',
    once_a_day: '每日一次',
    over_the_3_star_once: '必中★3+',
    over_the_4_star_once: '必中★4+',
  },
  label: {
    empty: '无',
    paymentMethod: '付费方式',
    pickup: '卡池PickUp',
    rateDistribution: '概率分布',
    rateMissing: '未提供概率分布数据',
  },
  paymentText: {
    drawCountSuffix: '次抽卡',
    limitPrefix: ' 仅限',
    limitSuffix: '次',
    unknownItemPrefix: ' ? x',
  },
} as const;

/**
 * 获取卡池支付行为展示名，未知行为保持原文。
 *
 * @param behavior - behavior 输入；限定 BangDream查询范围。
 */
export function getGachaPaymentBehaviorLabel(behavior: string) {
  return (
    BANGDREAM_GACHA_LIST_SPEC.behaviorLabels[
      behavior as keyof typeof BANGDREAM_GACHA_LIST_SPEC.behaviorLabels
    ] ?? behavior
  );
}
