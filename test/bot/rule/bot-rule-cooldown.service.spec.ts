import { ToolsService } from '@/common';
import { BotRuleService } from '@/modules/bot-adapter/core/application/rule/bot-rule.service';

/**
 * 创建 测试断言对象或配置。
 * @param config - config 输入；构造 Jest mock 返回值。
 */
function createService(config: Record<string, number | string | undefined>) {
  return new (BotRuleService as any)(
    {} as any,
    {} as any,
    new ToolsService(),
    {
      get: jest.fn((key: string) => config[key]),
    } as any,
  ) as BotRuleService;
}

describe('BotRuleService cooldown floor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-12T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a rule in cooldown when database cooldown is lower than the runtime floor', () => {
    const service = createService({
      BOT_RULE_MIN_COOLDOWN_MS: 30000,
    });

    expect(
      service.isInCooldown({
        cooldownMs: 500,
        lastHitAt: new Date(Date.now() - 10000),
      } as any),
    ).toBe(true);
  });
});
