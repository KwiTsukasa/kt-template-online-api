import { ToolsService } from '@/common';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotAccount } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';

describe('QqbotAccountService official credentials', () => {
  it.each(['official-websocket', 'official-webhook'] as const)(
    'encrypts AppSecret and namespaces AppID when creating %s account',
    async (connectionMode) => {
      const toolsService = new ToolsService();
      const accountRepository = {
        create: jest.fn((value) => value),
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(async (value) => ({ ...value, id: 'account-1' })),
      };
      const service = createService(accountRepository, toolsService);

      await expect(
        service.save({
          appId: '1020000000',
          appSecret: 'official-app-secret',
          connectionMode,
          enabled: true,
          name: '官方机器人',
        }),
      ).resolves.toBe('account-1');

      const payload = accountRepository.create.mock.calls[0][0];
      expect(payload).toEqual(
        expect.objectContaining({
          accessToken: null,
          connectionMode,
          napcatLoginPasswordSecret: null,
          officialAppId: '1020000000',
          selfId: 'qq-official:1020000000',
        }),
      );
      expect(
        toolsService.decryptSecretText(
          payload.officialAppSecretCiphertext,
          'unit-account-secret-key',
        ),
      ).toBe('official-app-secret');
      expect(JSON.stringify(payload)).not.toContain('official-app-secret');
    },
  );

  it('switches official WebSocket to Webhook while blank AppSecret preserves ciphertext and rejects NapCat conversion', async () => {
    const toolsService = new ToolsService();
    const ciphertext = toolsService.encryptSecretText(
      'official-app-secret',
      'unit-account-secret-key',
    );
    const current = {
      connectionMode: 'official-websocket',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      officialAppId: '1020000000',
      officialAppSecretCiphertext: ciphertext,
      selfId: 'qq-official:1020000000',
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const builder = {
      addSelect: jest.fn(),
      andWhere: jest.fn(),
      getOne: jest.fn().mockResolvedValue(current),
      setLock: jest.fn(),
      where: jest.fn(),
    };
    builder.addSelect.mockReturnValue(builder);
    builder.andWhere.mockReturnValue(builder);
    builder.setLock.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    const accountStore = {
      createQueryBuilder: jest.fn(() => builder),
      update,
    };
    const accountRepository = {
      findOne: jest.fn().mockResolvedValue(current),
      manager: {
        transaction: jest.fn(async (work) =>
          work({
            getRepository: (entity: unknown) => {
              if (entity === QqbotAccount) return accountStore;
              throw new Error('unexpected repository');
            },
          }),
        ),
      },
    };
    const service = createService(accountRepository, toolsService);

    await expect(
      service.update({
        appSecret: '   ',
        connectionMode: 'official-webhook',
        id: 'account-1',
      }),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(
      { id: 'account-1' },
      expect.objectContaining({ connectionMode: 'official-webhook' }),
    );
    expect(update.mock.calls[0][1]).not.toHaveProperty(
      'officialAppSecretCiphertext',
    );

    await expect(
      service.update({ connectionMode: 'reverse-ws', id: 'account-1' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'NapCat 与 QQ 官方账号不可互相切换；官方 WebSocket/Webhook 可直接切换',
      }),
    });
  });
});

const createService = (accountRepository: any, toolsService: ToolsService) =>
  new QqbotAccountService(
    accountRepository,
    { update: jest.fn() } as never,
    toolsService,
    undefined,
    undefined,
    {
      get: jest.fn((key: string) => {
        if (key === 'QQBOT_ACCOUNT_SECRET_KEY') {
          return 'unit-account-secret-key';
        }
        return '';
      }),
    } as never,
  );
