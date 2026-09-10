import { OfficialProfileReader } from '@/apps/persona-executor/official-profile';
import { readProfileResult } from '@/modules/plugins/persona-switch/src/profile-client';

describe('official QQ profile identity proof', () => {
  const profile = {
    username: '塔塔露',
    avatar: 'http://thirdqq.qlogo.cn/avatar',
    share_url:
      'https://qun.qq.com/qunpro/robot/qunshare?robot_uin=4013209631&robot_appid=1905461123',
  };
  afterEach(() => jest.restoreAllMocks());

  it('reads the live QQ profile and reuses only its bound access token', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url) => {
        if (String(url).includes('getAppAccessToken'))
          return new Response(
            JSON.stringify({ access_token: 'test-token', expires_in: 7200 }),
          );
        return new Response(JSON.stringify(profile));
      });
    const reader = new OfficialProfileReader('1905461123', 'test-secret');
    expect(await reader.read()).toEqual({
      name: '塔塔露',
      avatar: profile.avatar,
      uin: '4013209631',
    });
    await reader.read();
    expect(
      request.mock.calls.filter(([url]) =>
        String(url).includes('getAppAccessToken'),
      ),
    ).toHaveLength(1);
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith('/users/@me')),
    ).toHaveLength(2);
  });

  it('rejects a profile bound to another app even when the visible name matches', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'test-token', expires_in: 7200 }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...profile,
            share_url: profile.share_url.replace('1905461123', '1905461124'),
          }),
        ),
      );
    await expect(
      new OfficialProfileReader('1905461123', 'test-secret').read(),
    ).rejects.toThrow('身份不符');
  });

  it('does not accept old website-only success as QQ proof', () => {
    expect(
      readProfileResult(
        { id: 'job', status: 'applied', detail: '网页一致' },
        'job',
      ),
    ).toMatchObject({ status: 'uncertain' });
    expect(
      readProfileResult(
        {
          id: 'job',
          status: 'applied',
          detail: 'QQ一致',
          verifiedBy: 'qq-openapi-v1',
        },
        'job',
      ),
    ).toMatchObject({ status: 'applied', verifiedBy: 'qq-openapi-v1' });
  });
});
