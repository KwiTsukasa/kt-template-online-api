jest.mock('@/qqbot/rule/qqbot-rule-engine.service', () => ({
  QqbotRuleEngineService: class QqbotRuleEngineService {},
}));

import { QqbotEventService } from '@/qqbot/event/qqbot-event.service';

describe('QqbotEventService', () => {
  it('marks account offline with reason when NapCat reports kicked offline notice', async () => {
    const accountService = {
      markQqLoginOffline: jest.fn(),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue('notice-1'),
    };
    const service = new (QqbotEventService as any)(
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
      systemNoticePublisher,
    );

    const payload = {
      message:
        '[KickedOffLine] [下线通知] 你的帐号当前登录已失效，请重新登录。',
      notice_type: 'bot_offline',
      post_type: 'notice',
      self_id: 1914728559,
      sub_type: 'kick_offline',
    };

    await service.handleIncoming(payload);

    expect(accountService.markQqLoginOffline).toHaveBeenCalledWith(
      '1914728559',
      'bot_offline/kick_offline：你的帐号当前登录已失效，请重新登录。',
    );
    expect(systemNoticePublisher.publishSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'bot_offline/kick_offline：你的帐号当前登录已失效，请重新登录。',
        dedupeKey: 'qqbot:offline:1914728559',
        eventType: 'qqbot.account.offline',
        metadata: expect.objectContaining({
          payload,
          selfId: '1914728559',
        }),
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'qqbot',
        summary:
          'bot_offline/kick_offline：你的帐号当前登录已失效，请重新登录。',
        title: 'QQBot 账号已下线：1914728559',
      }),
    );
  });

  it('ignores normal group kick notices because they are not bot offline signals', async () => {
    const accountService = {
      markQqLoginOffline: jest.fn(),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn(),
    };
    const service = new (QqbotEventService as any)(
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
      systemNoticePublisher,
    );

    await service.handleIncoming({
      notice_type: 'group_decrease',
      operator_id: 12345,
      post_type: 'notice',
      self_id: 1914728559,
      sub_type: 'kick',
      user_id: 67890,
    });

    expect(accountService.markQqLoginOffline).not.toHaveBeenCalled();
    expect(systemNoticePublisher.publishSystemNotice).not.toHaveBeenCalled();
  });
});
