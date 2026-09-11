import { OfficialProfileReader } from '@/apps/persona-executor/official-profile';
import { readProfileResult } from '@/modules/plugins/persona-switch/src/profile-client';

describe('official QQ profile identity proof', () => {
  const profile = {
    selfId: 'qq-official:1020000001',
    appId: '1020000001',
    name: '塔塔露',
    avatar: 'http://thirdqq.qlogo.cn/avatar',
    uin: '4013209631',
  };
  afterEach(() => jest.restoreAllMocks());

  it('reads each job account through the NAS API without obtaining a bot secret or token', async () => {
    const request = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(profile));
    });
    const reader = new OfficialProfileReader(
      'http://127.0.0.1:48085',
      't'.repeat(32),
    );
    expect(await reader.read(profile.selfId)).toEqual({
      name: '塔塔露',
      avatar: profile.avatar,
      uin: '4013209631',
    });
    const second = {
      ...profile,
      appId: '1020000002',
      selfId: 'qq-official:1020000002',
    };
    request.mockResolvedValueOnce(new Response(JSON.stringify(second)));
    await reader.read(second.selfId);
    expect(request.mock.calls.map(([url]) => String(url))).toEqual(
      Array(2).fill('http://127.0.0.1:48085/bot-adapter/tencent/profile/read'),
    );
    expect(
      request.mock.calls.map(([, options]) =>
        JSON.parse(String(options?.body)),
      ),
    ).toEqual([{ selfId: profile.selfId }, { selfId: second.selfId }]);
  });

  it('rejects a profile bound to another app even when the visible name matches', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...profile,
          appId: '1020000002',
        }),
      ),
    );
    await expect(
      new OfficialProfileReader('http://127.0.0.1:48085', 't'.repeat(32)).read(
        profile.selfId,
      ),
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
