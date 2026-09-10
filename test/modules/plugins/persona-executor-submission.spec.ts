import { PersonaExecutor } from '@/apps/persona-executor/server';
import { BrowserSession } from '@/apps/persona-executor/webdriver';
import { OfficialProfileReader } from '@/apps/persona-executor/official-profile';
import { avatarsMatch } from '@/apps/persona-executor/media';

jest.mock('@/apps/persona-executor/webdriver');
jest.mock('@/apps/persona-executor/android');
jest.mock('@/apps/persona-executor/media');

describe('persona QQ profile submission', () => {
  const target = {
    id: 'e2430c81-d392-4003-8e02-abcf9afa70dd',
    name: '塔塔露',
    avatarHash: 'a'.repeat(64),
    status: 'queued',
    stage: 'queued',
    detail: '',
  };
  let executor: PersonaExecutor, api: jest.Mock;
  let liveName: string, liveAvatar: boolean, refuse: boolean;

  beforeEach(() => {
    const originalTimeout = global.setTimeout;
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback, delay, ...args) => {
        if (delay === 1500) return originalTimeout(callback, 0, ...args);
        return originalTimeout(callback, delay, ...args);
      });
    liveName = '柊司';
    liveAvatar = false;
    refuse = false;
    jest
      .spyOn(OfficialProfileReader.prototype, 'read')
      .mockImplementation(async () => ({
        name: liveName,
        avatar: 'http://thirdqq.qlogo.cn/current',
        uin: '4013209631',
      }));
    (avatarsMatch as jest.Mock).mockImplementation(async () => liveAvatar);
    api = jest.fn(async (path, body) => {
      if (path.endsWith('/query'))
        return {
          status: 200,
          data: {
            retcode: 0,
            data: {
              base_info: {
                bot_appid: '1905461123',
                bot_uin: '4013209631',
                bot_name: '塔塔露',
                bot_avatar: 'https://example.myqcloud.com/new.png',
              },
              developer_info: { admin_uin: '3229486494' },
            },
          },
        };
      if (path.endsWith('/pre_upload'))
        return {
          status: 200,
          data: {
            retcode: 0,
            data: {
              upload_url: 'https://example.myqcloud.com/upload',
              upload_id: 'test-upload',
            },
          },
        };
      if (refuse) return { status: 200, data: { retcode: 11005 } };
      if (body.filter.name === 1) liveName = body.name;
      if (body.filter.avatar === 1) liveAvatar = true;
      return { status: 200, data: { retcode: 0 } };
    });
    (BrowserSession as jest.Mock).mockImplementation(() => ({
      start: async () => {},
      navigate: async () => {},
      profileApi: api,
      upload: async () => true,
      close: async () => {},
    }));
    executor = new PersonaExecutor({
      root: 'unused',
      token: 't'.repeat(32),
      appId: '1905461123',
      appSecret: 'test-secret',
      adminQq: '3229486494',
      androidSerial: 'unused',
    });
    jest.spyOn(executor as any, 'persist').mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'avatar')
      .mockResolvedValue(Buffer.from('avatar'));
    jest
      .spyOn(executor as any, 'readPublicAvatar')
      .mockResolvedValue(Buffer.from('live'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('ignores matching website metadata and changes each actual QQ field separately', async () => {
    const job = { ...target };
    await (executor as any).execute(job);
    const writes = api.mock.calls.filter(([path]) => path.endsWith('/modify'));
    expect(writes.map(([, body]) => body.filter)).toEqual([
      { name: 1, avatar: 0, desc: 0, feature_preview: 0 },
      { name: 0, avatar: 1, desc: 0, feature_preview: 0 },
    ]);
    expect(writes[0][1]).toMatchObject({ name: '塔塔露', avatar_id: '' });
    expect(writes[1][1]).toMatchObject({ name: '', avatar_id: 'test-upload' });
    expect(job).toMatchObject({
      status: 'applied',
      verifiedBy: 'qq-openapi-v1',
      submittedFields: ['name', 'avatar'],
    });
  });

  it('never accepts website-only changes after 11005 and never repeats an uncertain field', async () => {
    refuse = true;
    const job = { ...target };
    await (executor as any).execute(job);
    expect(job.status).toBe('uncertain');
    expect(job.detail).toContain('11005');
    await (executor as any).execute(job);
    expect(
      api.mock.calls.filter(([path]) => path.endsWith('/modify')),
    ).toHaveLength(1);
    expect(job.status).toBe('uncertain');
  });

  it('continues only the unsubmitted avatar after a confirmed name survives restart', async () => {
    liveName = target.name;
    const job = {
      ...target,
      status: 'uncertain',
      stage: 'verify',
      submittedFields: ['name'],
    };
    await (executor as any).execute(job);
    expect(
      api.mock.calls
        .filter(([path]) => path.endsWith('/modify'))
        .map(([, body]) => body.filter),
    ).toEqual([{ name: 0, avatar: 1, desc: 0, feature_preview: 0 }]);
    expect(job.status).toBe('applied');
  });

  it('does not reapply legacy combined submissions when actual QQ fields differ', async () => {
    const job = { ...target, status: 'uncertain', stage: 'verify' };
    await (executor as any).execute(job);
    expect(job.status).toBe('uncertain');
    expect(api.mock.calls.every(([path]) => path.endsWith('/query'))).toBe(
      true,
    );
  });

  it('certifies an already matching actual profile without uploading or modifying', async () => {
    liveName = target.name;
    liveAvatar = true;
    const job = { ...target };
    await (executor as any).execute(job);
    expect(job).toMatchObject({
      status: 'applied',
      verifiedBy: 'qq-openapi-v1',
    });
    expect(api.mock.calls.every(([path]) => path.endsWith('/query'))).toBe(
      true,
    );
  });

  it('rejects a different QQ identity despite matching website name and avatar', async () => {
    jest
      .mocked(OfficialProfileReader.prototype.read)
      .mockResolvedValue({
        name: target.name,
        avatar: 'https://thirdqq.qlogo.cn/a',
        uin: '11111111',
      });
    liveAvatar = true;
    const job = { ...target };
    await (executor as any).execute(job);
    expect(job.status).toBe('failed');
    expect(api.mock.calls.every(([path]) => path.endsWith('/query'))).toBe(
      true,
    );
  });
});
