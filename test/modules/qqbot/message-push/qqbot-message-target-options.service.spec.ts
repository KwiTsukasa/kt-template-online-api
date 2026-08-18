import { QqbotMessageTargetOptionsService } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-target-options.service';

describe('QqbotMessageTargetOptionsService', () => {
  it('preserves large IDs, normalizes searchable labels, and keeps group/private IDs independent', async () => {
    const accountService = {
      findBySelfId: jest.fn().mockResolvedValue({ id: '1' }),
    };
    const reverseWsService = {
      sendAction: jest
        .fn()
        .mockResolvedValueOnce({
          data: [
            { group_id: '20000000000000001', group_name: '  KT 群  ' },
            { group_id: '20000000000000001', group_name: 'KT 群' },
          ],
          status: 'ok',
        })
        .mockResolvedValueOnce({
          data: [
            { nickname: '  阿雪  ', user_id: '20000000000000001' },
            { remark: '  备注  ', user_id: '30000000000000001' },
          ],
          status: 'ok',
        }),
    };
    const service = new QqbotMessageTargetOptionsService(
      accountService as never,
      reverseWsService as never,
    );

    await expect(
      service.listTargetOptions('10000000000000001'),
    ).resolves.toEqual({
      available: true,
      options: [
        {
          label: 'KT 群 (20000000000000001)',
          targetId: '20000000000000001',
          targetType: 'group',
        },
        {
          label: '备注 (30000000000000001)',
          targetId: '30000000000000001',
          targetType: 'private',
        },
        {
          label: '阿雪 (20000000000000001)',
          targetId: '20000000000000001',
          targetType: 'private',
        },
      ],
      reasonCode: null,
    });
    expect(reverseWsService.sendAction).toHaveBeenNthCalledWith(
      1,
      '10000000000000001',
      'get_group_list',
      {},
    );
    expect(reverseWsService.sendAction).toHaveBeenNthCalledWith(
      2,
      '10000000000000001',
      'get_friend_list',
      {},
    );
  });

  it('returns safe unavailable responses for a missing account, rejected action, and malformed payload', async () => {
    const accountService = { findBySelfId: jest.fn() };
    const reverseWsService = { sendAction: jest.fn() };
    const service = new QqbotMessageTargetOptionsService(
      accountService as never,
      reverseWsService as never,
    );

    accountService.findBySelfId.mockResolvedValueOnce(null);
    await expect(service.listTargetOptions('10001')).resolves.toEqual({
      available: false,
      options: [],
      reasonCode: 'account_unavailable',
    });
    expect(reverseWsService.sendAction).not.toHaveBeenCalled();

    accountService.findBySelfId.mockResolvedValue({ id: '1' });
    reverseWsService.sendAction.mockRejectedValueOnce(new Error('offline'));
    await expect(service.listTargetOptions('10001')).resolves.toEqual({
      available: false,
      options: [],
      reasonCode: 'onebot_unavailable',
    });

    reverseWsService.sendAction
      .mockResolvedValueOnce({ data: [{ group_id: 'bad' }], status: 'ok' })
      .mockResolvedValueOnce({ data: [], status: 'ok' });
    await expect(service.listTargetOptions('10001')).resolves.toEqual({
      available: false,
      options: [],
      reasonCode: 'onebot_unavailable',
    });
  });

  it('deduplicates equivalent OneBot candidates deterministically without discarding known names', async () => {
    const responses = [
      {
        data: [
          { group_id: '20000000000000001' },
          { group_id: '20000000000000001', group_name: 'Beta' },
          { group_id: '20000000000000001', group_name: 'Alpha' },
        ],
        status: 'ok',
      },
      { data: [], status: 'ok' },
    ];
    const accountService = {
      findBySelfId: jest.fn().mockResolvedValue({ id: '1' }),
    };
    const reverseWsService = {
      sendAction: jest.fn(async () => responses.shift()),
    };
    const service = new QqbotMessageTargetOptionsService(
      accountService as never,
      reverseWsService as never,
    );

    const first = await service.listTargetOptions('10001');
    responses.push(
      {
        data: [
          { group_id: '20000000000000001', group_name: 'Alpha' },
          { group_id: '20000000000000001', group_name: 'Beta' },
          { group_id: '20000000000000001' },
        ],
        status: 'ok',
      },
      { data: [], status: 'ok' },
    );
    const second = await service.listTargetOptions('10001');

    expect(first).toEqual({
      available: true,
      options: [
        {
          label: 'Alpha (20000000000000001)',
          targetId: '20000000000000001',
          targetType: 'group',
        },
      ],
      reasonCode: null,
    });
    expect(second).toEqual(first);
  });
});
