jest.mock('@/qqbot/rule/qqbot-rule-engine.service', () => ({
  QqbotRuleEngineService: class QqbotRuleEngineService {},
}));

import { QqbotEventService } from '@/qqbot/event/qqbot-event.service';

describe('QqbotEventService', () => {
  it('marks account offline with reason when NapCat reports kicked offline notice', async () => {
    const accountService = {
      markOffline: jest.fn(),
    };
    const service = new QqbotEventService(
      { publish: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getErrorMessage: (error: unknown) =>
          error instanceof Error ? error.message : `${error}`,
        toStringId: (value: unknown) => `${value || ''}`,
      } as any,
      accountService as any,
    );

    await service.handleIncoming({
      message: '[KickedOffLine] [下线通知] 你的帐号当前登录已失效，请重新登录。',
      notice_type: 'bot_offline',
      post_type: 'notice',
      self_id: 1914728559,
      sub_type: 'kick_offline',
    });

    expect(accountService.markOffline).toHaveBeenCalledWith(
      '1914728559',
      'bot_offline/kick_offline：你的帐号当前登录已失效，请重新登录。',
    );
  });
});
