import { ToolsService } from '@/common';
import { QqbotRuleService } from '@/qqbot/rule/qqbot-rule.service';

function createService(config: Record<string, number | string | undefined>) {
  return new (QqbotRuleService as any)(
    {} as any,
    {} as any,
    new ToolsService(),
    {
      get: jest.fn((key: string) => config[key]),
    } as any,
  ) as QqbotRuleService;
}

describe('QqbotRuleService cooldown floor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-12T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a rule in cooldown when database cooldown is lower than the runtime floor', () => {
    const service = createService({
      QQBOT_RULE_MIN_COOLDOWN_MS: 30000,
    });

    expect(
      service.isInCooldown({
        cooldownMs: 500,
        lastHitAt: new Date(Date.now() - 10000),
      } as any),
    ).toBe(true);
  });
});
