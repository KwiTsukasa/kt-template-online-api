jest.mock('@/common', () => {
  const actualCommon = jest.requireActual('@/common');
  return {
    FormatDateTime: actualCommon.FormatDateTime,
    ToolsService: actualCommon.ToolsService,
    ensureSnowflakeId: jest.fn(),
    formatKtDateTime: actualCommon.formatKtDateTime,
    setDictDecodeCache: jest.fn(),
    throwVbenError: (message: string) => {
      throw new Error(message);
    },
  };
});

import { ConfigService } from '@nestjs/config';
import { ToolsService } from '@/common';
import { QqbotNapcatContainerService } from '@/qqbot/napcat/qqbot-napcat-container.service';

describe('QqbotNapcatContainerService', () => {
  it('removes previous account containers when binding a new primary container', async () => {
    const bindingRepository = {
      create: jest.fn((input) => input),
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        where: jest.fn().mockReturnThis(),
      })),
      find: jest.fn().mockResolvedValue([
        {
          accountId: 'account-1',
          containerId: 'container-old',
          id: 'binding-old',
          isDeleted: false,
        },
      ]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      update: jest.fn(),
    };
    const containerRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'container-old',
        isDeleted: false,
        name: 'napcat-old',
      }),
      update: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      { get: jest.fn().mockReturnValue('') } as unknown as ConfigService,
      containerRepository as any,
      bindingRepository as any,
      new ToolsService(),
    );
    jest.spyOn(service as any, 'getManagedMode').mockReturnValue('');

    await service.bindAccount('account-1', 'container-new');

    expect(bindingRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        bindStatus: 'bound',
        containerId: 'container-new',
        isPrimary: true,
      }),
    );
    expect(containerRepository.update).toHaveBeenCalledWith(
      { id: 'container-old' },
      expect.objectContaining({
        isDeleted: true,
        status: 'stopped',
      }),
    );
    expect(bindingRepository.update).toHaveBeenCalledWith(
      { id: 'binding-old' },
      expect.objectContaining({
        bindStatus: 'disabled',
        isDeleted: true,
        isPrimary: false,
      }),
    );
  });
});
