import { formatKtDateTime, KtDateTime, KtDateTimeColumn } from '@/common';
import {
  getEffectiveCooldownMs,
  isWithinCooldown,
} from '@/qqbot/qqbot-cooldown.policy';

class CooldownEntityFixture {
  @KtDateTimeColumn()
  lastHitAt!: KtDateTime;
}

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

  it('keeps decorated entity datetime usable for cooldown checks', () => {
    const entity = new CooldownEntityFixture();
    entity.lastHitAt = new KtDateTime(new Date(Date.now() - 10000));

    expect(entity.lastHitAt).toBeInstanceOf(KtDateTime);
    expect(`${entity.lastHitAt}`).toBe(formatKtDateTime(entity.lastHitAt));
    expect(entity.lastHitAt).toBeInstanceOf(Date);
    expect(
      isWithinCooldown({
        cooldownMs: 500,
        lastHitAt: entity.lastHitAt,
        minCooldownMs: 30000,
      }),
    ).toBe(true);
  });
});
