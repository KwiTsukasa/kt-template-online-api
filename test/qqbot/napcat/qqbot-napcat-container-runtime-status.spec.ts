jest.mock('@/common', () => {
  const actualCommon = jest.requireActual('@/common');
  return {
    ...actualCommon,
    /**
     * 执行 NapCat回调。
     * @param message - message 输入；驱动 `Error()` 的 NapCat步骤。
     */
    throwVbenError: (message: string) => {
      throw new Error(message);
    },
  };
});

import { ToolsService } from '@/common';
import { QqbotNapcatContainerService } from '@/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service';

describe('QqbotNapcatContainerService runtime status', () => {
  /**
   * 创建 NapCat 登录运行态。
   * @param repository - repository 输入；生成 NapCat对象。
   */
  const createService = (repository: { update: jest.Mock }) =>
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

  it('reuses WebUI credential when checking the same running container repeatedly', async () => {
    const repository = {
      update: jest.fn(),
    };
    const service = createService(repository);
    const requestNapcat = jest
      .spyOn(service as any, 'requestNapcat')
      .mockImplementation(async (_runtime, path: string) => {
        if (path === '/api/auth/login') {
          return { Credential: 'credential-1' };
        }
        if (path === '/api/QQLogin/CheckLoginStatus') {
          return {
            isLogin: true,
            isOffline: false,
            loginError: '',
            online: true,
            qrcodeurl: '',
          };
        }
        throw new Error(`unexpected path ${path}`);
      });

    const container = {
      baseUrl: 'http://127.0.0.1:6100/',
      id: 'container-1',
      lastError: null,
      name: 'napcat-1',
      status: 'running',
      webuiPort: 6100,
      webuiToken: 'token',
    } as any;

    await service.inspectRuntimeStatus(container);
    await service.inspectRuntimeStatus(container);

    expect(
      requestNapcat.mock.calls.filter(
        ([, path]: unknown[]) => path === '/api/auth/login',
      ),
    ).toHaveLength(1);
    expect(
      requestNapcat.mock.calls.filter(
        ([, path]: unknown[]) => path === '/api/QQLogin/CheckLoginStatus',
      ),
    ).toHaveLength(2);
  });

  it('deduplicates concurrent WebUI credential requests for the same container', async () => {
    const repository = {
      update: jest.fn(),
    };
    const service = createService(repository);
    const requestNapcat = jest
      .spyOn(service as any, 'requestNapcat')
      .mockImplementation(async (_runtime, path: string) => {
        if (path === '/api/auth/login') {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { Credential: 'credential-1' };
        }
        if (path === '/api/QQLogin/CheckLoginStatus') {
          return {
            isLogin: true,
            isOffline: false,
            loginError: '',
            online: true,
            qrcodeurl: '',
          };
        }
        throw new Error(`unexpected path ${path}`);
      });

    const container = {
      baseUrl: 'http://127.0.0.1:6100/',
      id: 'container-1',
      lastError: null,
      name: 'napcat-1',
      status: 'running',
      webuiPort: 6100,
      webuiToken: 'token',
    } as any;

    await Promise.all([
      service.inspectRuntimeStatus(container),
      service.inspectRuntimeStatus(container),
    ]);

    expect(
      requestNapcat.mock.calls.filter(
        ([, path]: unknown[]) => path === '/api/auth/login',
      ),
    ).toHaveLength(1);
    expect(
      requestNapcat.mock.calls.filter(
        ([, path]: unknown[]) => path === '/api/QQLogin/CheckLoginStatus',
      ),
    ).toHaveLength(2);
  });

  it('refreshes cached WebUI credential once when NapCat rejects status auth', async () => {
    const repository = {
      update: jest.fn(),
    };
    const service = createService(repository);
    let credentialIndex = 0;
    let statusChecks = 0;
    const requestNapcat = jest
      .spyOn(service as any, 'requestNapcat')
      .mockImplementation(
        async (_runtime, path: string, _body, credential?: string) => {
          if (path === '/api/auth/login') {
            credentialIndex += 1;
            return { Credential: `credential-${credentialIndex}` };
          }
          if (path === '/api/QQLogin/CheckLoginStatus') {
            statusChecks += 1;
            if (statusChecks > 1 && credential === 'credential-1') {
              throw new Error('Unauthorized');
            }
            return {
              isLogin: true,
              isOffline: false,
              loginError: '',
              online: true,
              qrcodeurl: '',
            };
          }
          throw new Error(`unexpected path ${path}`);
        },
      );

    const container = {
      baseUrl: 'http://127.0.0.1:6100/',
      id: 'container-1',
      lastError: null,
      name: 'napcat-1',
      status: 'running',
      webuiPort: 6100,
      webuiToken: 'token',
    } as any;

    await service.inspectRuntimeStatus(container);
    const snapshot = await service.inspectRuntimeStatus(container);

    expect(snapshot).toEqual(
      expect.objectContaining({
        qqLoginStatus: 'online',
        webuiOnline: true,
      }),
    );
    expect(
      requestNapcat.mock.calls.filter(
        ([, path]: unknown[]) => path === '/api/auth/login',
      ),
    ).toHaveLength(2);
    expect(
      requestNapcat.mock.calls.filter(
        ([, path]: unknown[]) => path === '/api/QQLogin/CheckLoginStatus',
      ),
    ).toHaveLength(3);
  });

  it('keeps a refreshed credential when a later stale status request is rejected', async () => {
    const repository = {
      update: jest.fn(),
    };
    const service = createService(repository);
    let credentialIndex = 0;
    let staleMode = false;
    let staleStatusChecks = 0;
    let releaseSecondStaleReject: (() => void) | undefined;
    const secondStaleReject = new Promise<void>((resolve) => {
      releaseSecondStaleReject = resolve;
    });
    const requestNapcat = jest
      .spyOn(service as any, 'requestNapcat')
      .mockImplementation(
        async (_runtime, path: string, _body, credential?: string) => {
          if (path === '/api/auth/login') {
            credentialIndex += 1;
            return {
              Credential:
                credentialIndex === 1
                  ? 'credential-old'
                  : 'credential-new',
            };
          }
          if (path === '/api/QQLogin/CheckLoginStatus') {
            if (staleMode && credential === 'credential-old') {
              staleStatusChecks += 1;
              if (staleStatusChecks === 1) {
                throw new Error('Unauthorized');
              }
              await secondStaleReject;
              throw new Error('Unauthorized');
            }
            if (staleMode && credential === 'credential-new') {
              releaseSecondStaleReject?.();
            }
            return {
              isLogin: true,
              isOffline: false,
              loginError: '',
              online: true,
              qrcodeurl: '',
            };
          }
          throw new Error(`unexpected path ${path}`);
        },
      );

    const container = {
      baseUrl: 'http://127.0.0.1:6100/',
      id: 'container-1',
      lastError: null,
      name: 'napcat-1',
      status: 'running',
      webuiPort: 6100,
      webuiToken: 'token',
    } as any;

    await service.inspectRuntimeStatus(container);
    staleMode = true;

    await Promise.all([
      service.inspectRuntimeStatus(container),
      service.inspectRuntimeStatus(container),
    ]);

    expect(
      requestNapcat.mock.calls.filter(
        ([, path]: unknown[]) => path === '/api/auth/login',
      ),
    ).toHaveLength(2);
  });
});
