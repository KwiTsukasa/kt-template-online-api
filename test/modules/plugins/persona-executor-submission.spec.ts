import { PersonaExecutor } from '@/apps/persona-executor/server';
import { BrowserSession } from '@/apps/persona-executor/webdriver';

jest.mock('@/apps/persona-executor/webdriver');
jest.mock('@/apps/persona-executor/android');

describe('persona profile submission readback', () => {
  const target = {
    id: 'e2430c81-d392-4003-8e02-abcf9afa70dd',
    name: '塔塔露',
    avatarHash: 'a'.repeat(64),
    status: 'queued',
    stage: 'queued',
    detail: '',
  };
  let executor: PersonaExecutor;
  let api: jest.Mock, matches: jest.SpyInstance, close: jest.Mock;

  beforeEach(() => {
    const originalTimeout = global.setTimeout;
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback, delay, ...args) => {
        if (delay === 1500) return originalTimeout(callback, 0, ...args);
        return originalTimeout(callback, delay, ...args);
      });
    api = jest.fn(async (path) => {
      if (path.endsWith('/pre_upload'))
        return {
          status: 200,
          data: {
            retcode: 0,
            data: {
              upload_url: 'https://example.cos.ap-guangzhou.myqcloud.com/test',
              upload_id: 'test-upload',
            },
          },
        };
      return { status: 200, data: { retcode: 11005 } };
    });
    close = jest.fn(async () => {});
    (BrowserSession as jest.Mock).mockImplementation(() => ({
      start: async () => {},
      navigate: async () => {},
      profileApi: api,
      upload: async () => true,
      close,
    }));
    executor = new PersonaExecutor({
      root: 'unused',
      token: 't'.repeat(32),
      appId: '1905461123',
      adminQq: '3229486494',
      androidSerial: 'unused',
    });
    jest.spyOn(executor as any, 'persist').mockResolvedValue(undefined);
    jest.spyOn(executor as any, 'query').mockResolvedValue({ name: '原名' });
    jest
      .spyOn(executor as any, 'avatar')
      .mockResolvedValue(Buffer.from('avatar'));
    matches = jest.spyOn(executor as any, 'matches').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([0, 11005])(
    'accepts confirmed name and avatar despite platform code %s',
    async (code) => {
      api
        .mockImplementationOnce(async () => ({
          status: 200,
          data: {
            retcode: 0,
            data: {
              upload_url: 'https://example.myqcloud.com/test',
              upload_id: 'test-upload',
            },
          },
        }))
        .mockResolvedValue({ status: 200, data: { retcode: code } });
      matches.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const job = { ...target };
      await (executor as any).execute(job);
      expect(job).toMatchObject({
        status: 'applied',
        stage: 'done',
        detail: 'Bot 昵称和头像已读回一致。',
      });
      expect(
        api.mock.calls.filter(([path]) => path.endsWith('/modify')),
      ).toHaveLength(1);
      expect(matches).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it('waits for delayed readback after a nonzero code without resubmitting', async () => {
    matches
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const job = { ...target };
    await (executor as any).execute(job);
    expect(job.status).toBe('applied');
    expect(
      api.mock.calls.filter(([path]) => path.endsWith('/modify')),
    ).toHaveLength(1);
  });

  it('keeps unconfirmed nonzero responses uncertain and only reads on recovery', async () => {
    const job = { ...target };
    await (executor as any).execute(job);
    expect(job).toMatchObject({ status: 'uncertain', stage: 'verify' });
    expect(job.detail).toContain('11005');
    await (executor as any).execute(job);
    expect(
      api.mock.calls.filter(([path]) => path.endsWith('/modify')),
    ).toHaveLength(1);
    expect(job.status).toBe('uncertain');
  });

  it('finishes an already applied target without uploading or modifying it again', async () => {
    matches.mockResolvedValue(true);
    const job = { ...target };
    await (executor as any).execute(job);
    expect(job.status).toBe('applied');
    expect(api).not.toHaveBeenCalled();
  });
});
