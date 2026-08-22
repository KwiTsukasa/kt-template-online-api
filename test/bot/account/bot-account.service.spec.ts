import { ToolsService } from '@/common';
import type { BotAccountNapcatRuntimePort } from '@/modules/bot-adapter/core/application/account/bot-account-napcat-runtime.port';
import type { BotAccountExtensionRegistry } from '@/modules/bot-adapter/core/application/account/bot-account-extension.registry';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import { BotAccountAbility } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account-ability.entity';
import { BotAccount } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import { NapcatAccountRuntimeService } from '@/modules/bot-adapter/napcat/application/account-runtime/napcat-account-runtime.service';

const createAccountService = (input: {
  accountAbilityRepository?: any;
  accountExtensionRegistry?: BotAccountExtensionRegistry;
  accountRepository: any;
  configService?: any;
  napcatRuntime?: BotAccountNapcatRuntimePort;
  systemNoticePublisher?: any;
  toolsService?: ToolsService;
}) =>
  new BotAccountService(
    input.accountRepository,
    input.accountAbilityRepository || {},
    input.toolsService || new ToolsService(),
    input.napcatRuntime,
    input.systemNoticePublisher,
    input.configService,
    input.accountExtensionRegistry,
  );

const createNapcatRuntime = (input: {
  bindingRepository: any;
  containerRepository: any;
  containerService: any;
  toolsService?: ToolsService;
}) =>
  new NapcatAccountRuntimeService(
    input.bindingRepository,
    input.containerRepository,
    input.containerService,
    input.toolsService || new ToolsService(),
  );

const createAccountServiceWithNapcatRuntime = (input: {
  accountRepository: any;
  bindingRepository: any;
  configService?: any;
  containerRepository: any;
  containerService: any;
  systemNoticePublisher?: any;
  toolsService?: ToolsService;
}) => {
  const toolsService = input.toolsService || new ToolsService();
  return createAccountService({
    accountRepository: input.accountRepository,
    configService: input.configService,
    napcatRuntime: createNapcatRuntime({
      bindingRepository: input.bindingRepository,
      containerRepository: input.containerRepository,
      containerService: input.containerService,
      toolsService,
    }),
    systemNoticePublisher: input.systemNoticePublisher,
    toolsService,
  });
};

describe('BotAccountService', () => {
  it('delegates account cleanup to registered extensions without knowing message tables', async () => {
    const cancelAccountResources = jest.fn().mockResolvedValue(undefined);
    const manager = {};
    const service = createAccountService({
      accountExtensionRegistry: { cancelAccountResources } as never,
      accountRepository: {},
    });

    await (service as any).cancelAccountDeliveries(manager, 'account-1');

    expect(cancelAccountResources).toHaveBeenCalledWith(manager, 'account-1');
  });

  describe('administrative delivery cancellation transaction', () => {
    function cancellationHarness() {
      const accounts = [
        {
          accessToken: null,
          connectionMode: 'reverse-ws',
          enabled: true,
          id: 'account-1',
          isDeleted: false,
          name: 'Primary',
          remark: '',
          selfId: '1914728559',
        },
      ];
      const abilities = [
        {
          accountId: 'account-1',
          id: 'ability-1',
          isDeleted: false,
          selfId: '1914728559',
        },
      ];
      const bindings = [
        { accountId: 'account-1', id: 'binding-1' },
        { accountId: 'account-1', id: 'binding-2' },
        { accountId: 'account-2', id: 'binding-other' },
      ];
      const deliveries = [
        ...['waiting_ddns', 'pending', 'retry', 'processing', 'success'].map(
          (status) => ({
            bindingId: 'binding-1',
            frozen: `binding-1-${status}`,
            id: `binding-1-${status}`,
            nextAttemptAt: `schedule-${status}`,
            processingLeaseUntil: `lease-${status}`,
            status,
          }),
        ),
        {
          bindingId: 'binding-2',
          frozen: 'binding-2',
          id: 'binding-2-pending',
          nextAttemptAt: 'schedule-binding-2',
          processingLeaseUntil: 'lease-binding-2',
          status: 'pending',
        },
        {
          bindingId: 'binding-other',
          frozen: 'other',
          id: 'binding-other-pending',
          nextAttemptAt: 'schedule-other',
          processingLeaseUntil: 'lease-other',
          status: 'pending',
        },
      ];
      const operations: string[] = [];
      let failCancellation = false;
      const transaction = jest.fn(
        async (work: (manager: any) => Promise<unknown>) => {
          operations.push('transaction:start');
          const draftAccounts = structuredClone(accounts);
          const draftAbilities = structuredClone(abilities);
          const draftDeliveries = structuredClone(deliveries);
          const accountStore = {
            createQueryBuilder: jest.fn(() => {
              const query: Record<string, unknown> = {};
              const builder = {
                addSelect: jest.fn(() => builder),
                andWhere: jest.fn(
                  (_sql: string, params: Record<string, unknown>) => {
                    Object.assign(query, params);
                    return builder;
                  },
                ),
                getOne: jest.fn(async () => {
                  const row = draftAccounts.find((candidate) =>
                    Object.entries(query).every(
                      ([key, value]) => candidate[key] === value,
                    ),
                  );
                  return row ? structuredClone(row) : null;
                }),
                setLock: jest.fn(() => {
                  operations.push('account:lock');
                  return builder;
                }),
                where: jest.fn(
                  (_sql: string, params: Record<string, unknown>) => {
                    Object.assign(query, params);
                    return builder;
                  },
                ),
              };
              return builder;
            }),
            findOne: jest.fn(
              async ({
                lock,
                where,
              }: {
                lock?: { mode: string };
                where: Record<string, unknown>;
              }) => {
                if (lock) operations.push('account:lock');
                const row = draftAccounts.find((candidate) =>
                  Object.entries(where).every(
                    ([key, value]) => candidate[key] === value,
                  ),
                );
                return row ? structuredClone(row) : null;
              },
            ),
            update: jest.fn(
              async (
                where: Record<string, unknown>,
                patch: Record<string, unknown>,
              ) => {
                operations.push('account:update');
                const row = draftAccounts.find((candidate) =>
                  Object.entries(where).every(
                    ([key, value]) => candidate[key] === value,
                  ),
                );
                if (!row) return { affected: 0 };
                Object.assign(row, patch);
                return { affected: 1 };
              },
            ),
          };
          const manager = {
            deliveryDraft: draftDeliveries,
            getRepository: (entity: unknown) => {
              if (entity === BotAccount) return accountStore;
              if (entity === BotAccountAbility) {
                return {
                  update: async (
                    where: Record<string, unknown>,
                    patch: Record<string, unknown>,
                  ) => {
                    operations.push('ability:update');
                    draftAbilities
                      .filter((row) =>
                        Object.entries(where).every(
                          ([key, value]) => row[key] === value,
                        ),
                      )
                      .forEach((row) => Object.assign(row, patch));
                    return { affected: 1 };
                  },
                };
              }
              throw new Error('unexpected account repository');
            },
          };
          const result = await work(manager);
          accounts.splice(0, accounts.length, ...draftAccounts);
          abilities.splice(0, abilities.length, ...draftAbilities);
          deliveries.splice(0, deliveries.length, ...draftDeliveries);
          operations.push('transaction:commit');
          return result;
        },
      );
      const accountRepository = {
        findOne: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            const row = accounts.find((candidate) =>
              Object.entries(where).every(
                ([key, value]) => candidate[key] === value,
              ),
            );
            return row ? structuredClone(row) : null;
          },
        ),
        manager: { transaction },
        update: jest.fn(),
      };
      const removeAccountContainers = jest.fn(async () => {
        operations.push('external:remove');
        return { deletedContainers: 1 };
      });
      const cancelAccountResources = jest.fn(
        async (
          manager: { deliveryDraft: typeof deliveries },
          accountId: string,
        ) => {
          operations.push('extension:cancel');
          const bindingIds = bindings
            .filter((binding) => binding.accountId === accountId)
            .map((binding) => binding.id);
          manager.deliveryDraft.forEach((delivery) => {
            if (
              bindingIds.includes(delivery.bindingId) &&
              ['waiting_ddns', 'pending', 'retry'].includes(delivery.status)
            ) {
              Object.assign(delivery, {
                nextAttemptAt: null,
                processingLeaseUntil: null,
                status: 'cancelled',
              });
            }
          });
          if (failCancellation) {
            throw new Error('account cancellation failed');
          }
        },
      );
      const service = createAccountService({
        accountAbilityRepository: { update: jest.fn() },
        accountExtensionRegistry: { cancelAccountResources } as never,
        accountRepository,
        napcatRuntime: { removeAccountContainers } as never,
      });
      return {
        abilities,
        accounts,
        cancelAccountResources,
        deliveries,
        failCancellation: () => {
          failCancellation = true;
        },
        operations,
        removeAccountContainers,
        service,
        transaction,
      };
    }

    function expectAccountDeliveriesCancelled(
      before: Array<Record<string, unknown>>,
      after: Array<Record<string, unknown>>,
    ): void {
      expect(after).toEqual(
        before.map((delivery) =>
          ['binding-1', 'binding-2'].includes(String(delivery.bindingId)) &&
          ['waiting_ddns', 'pending', 'retry'].includes(String(delivery.status))
            ? {
                ...delivery,
                nextAttemptAt: null,
                processingLeaseUntil: null,
                status: 'cancelled',
              }
            : delivery,
        ),
      );
    }

    it.each([
      [
        'administrative disable',
        async (service: BotAccountService) =>
          service.update({ enabled: false, id: 'account-1' }),
      ],
      [
        'actual selfId replacement',
        async (service: BotAccountService) =>
          service.update({
            id: 'account-1',
            selfId: '1914728560',
          }),
      ],
      [
        'administrative delete',
        async (service: BotAccountService) => service.remove('account-1'),
      ],
    ])(
      '%s commits account state and exact delivery cancellations',
      async (_name, mutate) => {
        const harness = cancellationHarness();
        const before = structuredClone(harness.deliveries);

        await mutate(harness.service);

        expectAccountDeliveriesCancelled(before, harness.deliveries);
        expect(harness.operations.indexOf('account:lock')).toBeLessThan(
          harness.operations.indexOf('extension:cancel'),
        );
        expect(harness.cancelAccountResources).toHaveBeenCalledWith(
          expect.any(Object),
          'account-1',
        );
        expect(harness.operations.at(-1)).toBe('transaction:commit');
      },
    );

    it('same selfId and metadata-only updates do not cancel frozen deliveries', async () => {
      const sameSelfId = cancellationHarness();
      const sameBefore = structuredClone(sameSelfId.deliveries);
      await sameSelfId.service.update({
        id: 'account-1',
        name: 'Renamed',
        selfId: '1914728559',
      });
      expect(sameSelfId.deliveries).toEqual(sameBefore);
      expect(sameSelfId.operations).not.toContain('extension:cancel');

      const metadata = cancellationHarness();
      const metadataBefore = structuredClone(metadata.deliveries);
      await metadata.service.update({ id: 'account-1', remark: 'metadata' });
      expect(metadata.deliveries).toEqual(metadataBefore);
      expect(metadata.operations).not.toContain('extension:cancel');
    });

    it('runtime online/offline changes stay outside administrative cancellation', async () => {
      const harness = cancellationHarness();
      const before = structuredClone(harness.deliveries);

      await harness.service.markOnline('1914728559', 'Universal');
      await harness.service.markOffline('1914728559');
      await harness.service.markHeartbeat('1914728559');

      expect(harness.transaction).not.toHaveBeenCalled();
      expect(harness.deliveries).toEqual(before);
    });

    it('rolls back account, ability, and delivery drafts together when cancellation fails', async () => {
      const harness = cancellationHarness();
      const before = {
        abilities: structuredClone(harness.abilities),
        accounts: structuredClone(harness.accounts),
        deliveries: structuredClone(harness.deliveries),
      };
      harness.failCancellation();

      await expect(
        harness.service.update({
          id: 'account-1',
          selfId: '1914728560',
        }),
      ).rejects.toThrow('account cancellation failed');

      expect(harness.accounts).toEqual(before.accounts);
      expect(harness.abilities).toEqual(before.abilities);
      expect(harness.deliveries).toEqual(before.deliveries);
      expect(harness.operations).not.toContain('transaction:commit');
    });

    it('keeps external removal outside the DB transaction while rolling back authoritative delete state', async () => {
      const harness = cancellationHarness();
      const before = {
        abilities: structuredClone(harness.abilities),
        accounts: structuredClone(harness.accounts),
        deliveries: structuredClone(harness.deliveries),
      };
      harness.failCancellation();

      await expect(harness.service.remove('account-1')).rejects.toThrow(
        'account cancellation failed',
      );

      expect(harness.operations[0]).toBe('external:remove');
      expect(harness.accounts).toEqual(before.accounts);
      expect(harness.abilities).toEqual(before.abilities);
      expect(harness.deliveries).toEqual(before.deliveries);
      expect(harness.removeAccountContainers).toHaveBeenCalledTimes(1);
    });
  });
  it('stores NapCat login password as encrypted secret and never persists the transport field', async () => {
    const toolsService = new ToolsService();
    const encryptSecretText = jest.spyOn(toolsService, 'encryptSecretText');
    const systemNoticePublisher = {
      publish: jest.fn(),
    };
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn((key: string) =>
          key === 'BOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      systemNoticePublisher,
      toolsService,
    });

    const result = await service.save({
      loginPassword: 'qq-login-password',
      selfId: '1914728559',
    });

    const payload = accountRepository.create.mock.calls[0][0];
    expect(encryptSecretText).toHaveBeenCalledTimes(1);
    expect(encryptSecretText).toHaveBeenCalledWith(
      'qq-login-password',
      'unit-secret',
    );
    expect(payload.loginPassword).toBeUndefined();
    expect(payload.encryptedLoginPassword).toBeUndefined();
    expect(payload.napcatLoginPasswordSecret).toMatch(/^ktv1:/);
    expect(payload.napcatLoginPasswordSecret).not.toContain(
      'qq-login-password',
    );
    expect(JSON.stringify(accountRepository.save.mock.calls)).not.toContain(
      'qq-login-password',
    );
    expect(JSON.stringify(result)).not.toContain('qq-login-password');
    expect(systemNoticePublisher.publish).not.toHaveBeenCalled();
    expect(
      toolsService.decryptSecretText(
        payload.napcatLoginPasswordSecret,
        'unit-secret',
      ),
    ).toBe('qq-login-password');
  });

  it('requires an explicit secret key before storing NapCat login password', async () => {
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn().mockReturnValue(''),
      },
    });

    await expect(
      service.save({
        loginPassword: 'qq-login-password',
        selfId: '1914728559',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'Bot 账号登录密码密钥未配置，请设置 BOT_ACCOUNT_SECRET_KEY 或 ADMIN_TOKEN_SECRET',
      }),
    });
    expect(accountRepository.save).not.toHaveBeenCalled();
  });

  it('rejects public placeholder secret before storing NapCat login password', async () => {
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn((key: string) =>
          key === 'ADMIN_TOKEN_SECRET' ? 'change-me' : '',
        ),
      },
    });

    await expect(
      service.save({
        loginPassword: 'qq-login-password',
        selfId: '1914728559',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'Bot 账号登录密码密钥未配置，请设置 BOT_ACCOUNT_SECRET_KEY 或 ADMIN_TOKEN_SECRET',
      }),
    });
    expect(accountRepository.save).not.toHaveBeenCalled();
  });

  it('preserves NapCat login password whitespace during request-scoped wrapping', async () => {
    const toolsService = new ToolsService();
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn((key: string) =>
          key === 'BOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      toolsService,
    });

    await service.save({
      loginPassword: ' qq-login-password ',
      selfId: '1914728559',
    });

    const payload = accountRepository.create.mock.calls[0][0];
    expect(
      toolsService.decryptSecretText(
        payload.napcatLoginPasswordSecret,
        'unit-secret',
      ),
    ).toBe(' qq-login-password ');
  });

  it('does not update NapCat login password when edit leaves the password blank', async () => {
    const toolsService = new ToolsService();
    const encryptSecretText = jest.spyOn(toolsService, 'encryptSecretText');
    const accountUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const account = {
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      selfId: '1914728559',
    };
    const accountRepository = {
      findOne: jest.fn().mockResolvedValue(account),
      manager: {
        transaction: async (work: (manager: any) => Promise<unknown>) =>
          work({
            getRepository: (entity: unknown) => {
              if (entity === BotAccount) {
                const builder = {
                  addSelect: jest.fn(() => builder),
                  andWhere: jest.fn(() => builder),
                  getOne: jest.fn().mockResolvedValue({
                    ...account,
                    connectionMode: 'reverse-ws',
                  }),
                  setLock: jest.fn(() => builder),
                  where: jest.fn(() => builder),
                };
                return {
                  createQueryBuilder: jest.fn(() => builder),
                  update: accountUpdate,
                };
              }
              throw new Error('unexpected repository');
            },
          }),
      },
      update: jest.fn(),
    };
    const service = createAccountService({
      accountAbilityRepository: { update: jest.fn() },
      accountRepository,
      toolsService,
    });

    await service.update({
      id: 'account-1',
      loginPassword: '   ',
      name: 'Mirror',
      selfId: '1914728559',
    });

    expect(accountUpdate).toHaveBeenCalledWith(
      { id: 'account-1' },
      expect.not.objectContaining({
        encryptedLoginPassword: expect.anything(),
        loginPassword: expect.anything(),
        napcatLoginPasswordSecret: expect.anything(),
      }),
    );
    expect(encryptSecretText).not.toHaveBeenCalled();
  });

  it('preserves previous offline reason when later disconnect has no explicit error', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

    await service.markOffline('1914728559');

    expect(accountRepository.update).toHaveBeenCalledWith(
      { connectionMode: 'reverse-ws', selfId: '1914728559' },
      expect.objectContaining({
        connectStatus: 'offline',
        oneBotStatus: 'offline',
      }),
    );
  });

  it('preserves QQ login error when OneBot connection comes online', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

    await service.markOnline('1914728559', 'Universal');

    const updatePayload = accountRepository.update.mock.calls[0][1];
    expect(updatePayload).toEqual(
      expect.objectContaining({
        clientRole: 'Universal',
        connectStatus: 'online',
        lastConnectedAt: expect.any(Date),
      }),
    );
    expect(updatePayload).not.toHaveProperty('lastError');
  });

  it('clears QQ login error only when online state is explicitly confirmed', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

    await service.markOnline('1914728559', 'Universal', null);

    expect(accountRepository.update).toHaveBeenCalledWith(
      { connectionMode: 'reverse-ws', selfId: '1914728559' },
      expect.objectContaining({
        clientRole: 'Universal',
        connectStatus: 'online',
        lastConnectedAt: expect.any(Date),
        lastError: null,
      }),
    );
  });

  it('persists split OneBot online status when heartbeat arrives', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

    await service.markHeartbeat('1914728559');

    expect(accountRepository.update).toHaveBeenCalledWith(
      { connectionMode: 'reverse-ws', selfId: '1914728559' },
      expect.objectContaining({
        connectStatus: 'online',
        lastHeartbeatAt: expect.any(Date),
        oneBotStatus: 'online',
      }),
    );
  });

  it('truncates offline reason before writing lastError column', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

    await service.markOffline('1914728559', '错误'.repeat(300));

    expect(accountRepository.update).toHaveBeenCalledWith(
      { connectionMode: 'reverse-ws', selfId: '1914728559' },
      expect.objectContaining({
        connectStatus: 'offline',
        lastError: `${'错误'.repeat(248)}错...`,
        oneBotStatus: 'offline',
      }),
    );
  });

  it('syncs NapCat runtime offline logs back to account list status', async () => {
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastError: null,
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const createAccountBuilder = () => ({
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    const createBindingBuilder = () => ({
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([binding]),
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    const createContainerBuilder = () => ({
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([container]),
      where: jest.fn().mockReturnThis(),
    });
    const accountRepository = {
      createQueryBuilder: jest.fn(createAccountBuilder),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest
        .fn()
        .mockResolvedValue('NapCat 账号状态变更为离线'),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue('notice-1'),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: { createQueryBuilder: jest.fn(createBindingBuilder) },
      containerRepository: {
        createQueryBuilder: jest.fn(createContainerBuilder),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
    });

    const page = await service.page({});

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      expect.objectContaining({
        lastError: 'NapCat 账号状态变更为离线',
        qqLoginStatus: 'offline',
      }),
    );
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        lastError: 'NapCat 账号状态变更为离线',
        napcat: expect.objectContaining({
          oneBotOnline: true,
          qqLoginStatus: 'offline',
        }),
      }),
    );
    expect(systemNoticePublisher.publishSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'NapCat 账号状态变更为离线\n请在 Admin 的 Bot 账号页面手动点击「更新登录」重新登录。',
        dedupeKey: 'bot:offline:1914728559',
        eventType: 'bot.account.offline',
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'bot',
        title: 'Bot 账号已下线：1914728559',
      }),
    );
  });

  it('does not re-read NapCat logs when the container was checked recently', async () => {
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: new Date(),
      lastError: null,
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest.fn(),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

    const page = await service.page({});

    expect(napcatContainerService.detectRuntimeOffline).not.toHaveBeenCalled();
    expect(accountRepository.update).not.toHaveBeenCalled();
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        napcat: expect.objectContaining({
          lastCheckedAt: container.lastCheckedAt,
        }),
      }),
    );
  });

  it('separates OneBot, container, WebUI and QQ login status for offline accounts', async () => {
    const account = {
      connectStatus: 'offline',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: new Date('2026-06-11T02:00:00.000Z'),
      lastError: null,
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      inspectRuntimeStatus: jest.fn().mockResolvedValue({
        checkedAt: new Date('2026-06-12T12:00:00.000Z'),
        containerOnline: true,
        lastError: '二维码已过期，请刷新',
        qqLoginMessage: '二维码已过期，请刷新',
        qqLoginStatus: 'qrcode_expired',
        webuiOnline: true,
      }),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

    const page = await service.page({});

    expect(napcatContainerService.inspectRuntimeStatus).toHaveBeenCalledWith(
      container,
    );
    expect(accountRepository.update).not.toHaveBeenCalled();
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'offline',
        napcat: expect.objectContaining({
          containerOnline: true,
          oneBotOnline: false,
          qqLoginMessage: '二维码已过期，请刷新',
          qqLoginStatus: 'qrcode_expired',
          webuiOnline: true,
        }),
      }),
    );
  });

  it('does not expose WebUI errors as QQ login messages in cached runtime status', async () => {
    const checkedAt = new Date();
    const account = {
      connectStatus: 'offline',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: checkedAt,
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: checkedAt,
      lastError: 'NapCat WebUI 配置缺失',
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: {},
    });

    const page = await service.page({});

    expect(page.list[0].napcat).toEqual(
      expect.objectContaining({
        containerOnline: true,
        lastError: 'NapCat WebUI 配置缺失',
        qqLoginMessage: null,
        qqLoginStatus: 'unknown',
        webuiOnline: null,
      }),
    );
  });

  it('does not derive QQ login online status from OneBot heartbeat cache', async () => {
    const checkedAt = new Date();
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      lastHeartbeatAt: new Date(),
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: checkedAt,
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: checkedAt,
      lastError: null,
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: {},
    });

    const page = await service.page({});

    expect(page.list[0].napcat).toEqual(
      expect.objectContaining({
        oneBotOnline: true,
        qqLoginStatus: 'unknown',
        webuiOnline: null,
      }),
    );
  });

  it('ignores cached NapCat offline reason after the account reconnects', async () => {
    const now = Date.now();
    const checkedAt = new Date(now - 10_000);
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastConnectedAt: new Date(now - 5_000),
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: checkedAt,
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: checkedAt,
      lastError: '账号状态变更为离线',
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest.fn(),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue(undefined),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
    });

    const page = await service.page({});

    expect(napcatContainerService.detectRuntimeOffline).not.toHaveBeenCalled();
    expect(accountRepository.update).not.toHaveBeenCalled();
    expect(systemNoticePublisher.publishSystemNotice).not.toHaveBeenCalled();
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        lastError: null,
      }),
    );
  });

  it('does not let heartbeat bypass stale NapCat offline inspection', async () => {
    const checkedAt = new Date(Date.now() - 60_000);
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastConnectedAt: new Date(Date.now() - 120_000),
      lastError: null,
      lastHeartbeatAt: new Date(),
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: checkedAt,
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: checkedAt,
      lastError: null,
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      inspectRuntimeStatus: jest.fn().mockResolvedValue({
        checkedAt: new Date(),
        containerOnline: true,
        lastError: '账号状态变更为离线',
        qqLoginMessage: '账号状态变更为离线',
        qqLoginStatus: 'offline',
        webuiOnline: true,
      }),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

    const page = await service.page({});

    expect(napcatContainerService.inspectRuntimeStatus).toHaveBeenCalledWith(
      container,
    );
    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      expect.objectContaining({
        lastError: '账号状态变更为离线',
        qqLoginStatus: 'offline',
      }),
    );
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        lastError: '账号状态变更为离线',
        napcat: expect.objectContaining({
          oneBotOnline: true,
          qqLoginStatus: 'offline',
        }),
      }),
    );
  });

  it('clears previous QQ login error when NapCat WebUI confirms QQ is online', async () => {
    const checkedAt = new Date(Date.now() - 60_000);
    const account = {
      containerStatus: 'unknown',
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastConnectedAt: new Date(Date.now() - 120_000),
      lastError: '账号状态变更为离线',
      name: '主账号',
      oneBotStatus: 'offline',
      qqLoginStatus: 'unknown',
      selfId: '1914728559',
      webuiStatus: 'unknown',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: checkedAt,
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: checkedAt,
      lastError: '账号状态变更为离线',
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      inspectRuntimeStatus: jest.fn().mockResolvedValue({
        checkedAt: new Date(),
        containerOnline: true,
        lastError: null,
        qqLoginMessage: null,
        qqLoginStatus: 'online',
        webuiOnline: true,
      }),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

    const page = await service.page({});

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      { lastError: null },
    );
    expect(accountRepository.update).toHaveBeenCalledWith(
      { id: 'account-1' },
      expect.objectContaining({
        containerStatus: 'running',
        oneBotStatus: 'online',
        qqLoginStatus: 'online',
        webuiStatus: 'online',
      }),
    );
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        lastError: null,
        napcat: expect.objectContaining({
          qqLoginStatus: 'online',
        }),
      }),
    );
  });

  it('notifies manual re-login instead of auto-login when watchdog detects QQ login offline', async () => {
    const toolsService = new ToolsService();
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      napcatLoginPasswordSecret: toolsService.encryptSecretText(
        'qq-login-password',
        'unit-secret',
      ),
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastError: null,
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([account]),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest
        .fn()
        .mockResolvedValue('NapCat 账号状态变更为离线'),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue(undefined),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      configService: {
        get: jest.fn((key: string) =>
          key === 'BOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
      toolsService,
    });

    const result = await service.runOfflineWatchdog();

    expect(result).toEqual({ checked: 1 });
    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      expect.objectContaining({
        lastError: 'NapCat 账号状态变更为离线',
        qqLoginStatus: 'offline',
      }),
    );
    expect(systemNoticePublisher.publishSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'NapCat 账号状态变更为离线\n请在 Admin 的 Bot 账号页面手动点击「更新登录」重新登录。',
        eventType: 'bot.account.offline',
        severity: 'error',
        title: 'Bot 账号已下线：1914728559',
      }),
    );
  });

  it('never reports auto-login cleanup failure from watchdog because watchdog no longer logs in', async () => {
    const toolsService = new ToolsService();
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      napcatLoginPasswordSecret: toolsService.encryptSecretText(
        'qq-login-password',
        'unit-secret',
      ),
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastError: null,
      name: 'kt-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([account]),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest
        .fn()
        .mockResolvedValue('NapCat 账号状态变更为离线'),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue(undefined),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      configService: {
        get: jest.fn((key: string) =>
          key === 'BOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
      toolsService,
    });

    await service.runOfflineWatchdog();

    expect(accountRepository.update).toHaveBeenCalledTimes(1);
    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      expect.objectContaining({
        lastError: 'NapCat 账号状态变更为离线',
        qqLoginStatus: 'offline',
      }),
    );
    expect(systemNoticePublisher.publishSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'NapCat 账号状态变更为离线\n请在 Admin 的 Bot 账号页面手动点击「更新登录」重新登录。',
        eventType: 'bot.account.offline',
        severity: 'error',
        title: 'Bot 账号已下线：1914728559',
      }),
    );
    expect(JSON.stringify(accountRepository.update.mock.calls)).not.toContain(
      'NapCat 自动登录后运行态密码清理失败，请手动更新登录',
    );
  });
});
