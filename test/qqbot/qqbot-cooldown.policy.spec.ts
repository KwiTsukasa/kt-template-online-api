import {
  getEffectiveCooldownMs,
  isWithinCooldown,
} from '@/qqbot/qqbot-cooldown.policy';

describe('QQBot cooldown policy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-12T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the runtime floor when the database cooldown is too low', () => {
    expect(getEffectiveCooldownMs(500, 30000)).toBe(30000);
  });

  it('keeps a hit in cooldown by the effective runtime floor', () => {
    expect(
      isWithinCooldown({
        cooldownMs: 500,
        lastHitAt: new Date(Date.now() - 10000),
        minCooldownMs: 30000,
      }),
    ).toBe(true);
  });
});
