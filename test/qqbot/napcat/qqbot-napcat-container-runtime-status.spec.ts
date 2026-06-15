jest.mock('@/common', () => {
  const actualCommon = jest.requireActual('@/common');
  return {
    ...actualCommon,
    throwVbenError: (message: string) => {
      throw new Error(message);
    },
  };
});

import { ToolsService } from '@/common';
import { QqbotNapcatContainerService } from '@/modules/qqbot/napcat/qqbot-napcat-container.service';

describe('QqbotNapcatContainerService runtime status', () => {
  const createService = (repository: {
    update: jest.Mock;
  }) =>
    new QqbotNapcatContainerService(
      { get: jest.fn() } as any,
      repository as any,
      {} as any,
      new ToolsService(),
    );

  it('keeps WebUI configuration errors out of the QQ login message', async () => {
    const repository = {
      update: jest.fn(),
    };
    const service = createService(repository);

    const snapshot = await service.inspectRuntimeStatus({
      id: 'container-1',
      lastError: null,
      status: 'running',
    } as any);

    expect(snapshot).toEqual(
      expect.objectContaining({
        lastError: 'NapCat WebUI 配置缺失',
        qqLoginMessage: null,
        qqLoginStatus: 'unknown',
        webuiOnline: false,
      }),
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'container-1' },
      expect.objectContaining({
        lastError: 'NapCat WebUI 配置缺失',
      }),
    );
  });

  it('keeps WebUI request errors out of the QQ login message', async () => {
    const repository = {
      update: jest.fn(),
    };
    const service = createService(repository);
    jest
      .spyOn(service as any, 'getNapcatCredential')
      .mockRejectedValue(new Error('NapCat WebUI 请求超时'));

    const snapshot = await service.inspectRuntimeStatus({
      baseUrl: 'http://127.0.0.1:6100/',
      id: 'container-1',
      lastError: null,
      status: 'running',
      webuiToken: 'token',
    } as any);

    expect(snapshot).toEqual(
      expect.objectContaining({
        lastError: 'NapCat WebUI 请求超时',
        qqLoginMessage: null,
        qqLoginStatus: 'unknown',
        webuiOnline: false,
      }),
    );
  });
});
