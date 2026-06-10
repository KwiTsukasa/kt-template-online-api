import { QqbotAccountService } from '@/qqbot/account/qqbot-account.service';

describe('QqbotAccountService', () => {
  it('preserves previous offline reason when later disconnect has no explicit error', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.markOffline('1914728559');

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        connectStatus: 'offline',
      },
    );
  });
});
