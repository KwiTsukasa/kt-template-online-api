import {
  BANGDREAM_GACHA_LIST_SPEC,
  getGachaPaymentBehaviorLabel,
} from '@/qqbot/plugins/bangDream/gacha/gacha-list.layout';

describe('BangDream gacha list spec', () => {
  it('keeps gacha list labels stable', () => {
    expect(BANGDREAM_GACHA_LIST_SPEC.label).toEqual({
      empty: '无',
      paymentMethod: '付费方式',
      pickup: '卡池PickUp',
      rateDistribution: '概率分布',
      rateMissing: '未提供概率分布数据',
    });
  });

  it('maps known payment behaviors and keeps unknown behavior unchanged', () => {
    expect(getGachaPaymentBehaviorLabel('normal')).toBe('');
    expect(getGachaPaymentBehaviorLabel('over_the_3_star_once')).toBe(
      '必中★3+',
    );
    expect(getGachaPaymentBehaviorLabel('fixed_5_star_once')).toBe('必中★5');
    expect(getGachaPaymentBehaviorLabel('custom_behavior')).toBe(
      'custom_behavior',
    );
  });
});
