import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Canvas } from 'skia-canvas';
import { PersonaExecutor } from '@/apps/persona-executor/server';
import { BrowserSession } from '@/apps/persona-executor/webdriver';
import { OfficialProfileReader } from '@/apps/persona-executor/official-profile';
import {
  normalizeAvatar,
  avatarsMatch,
  qrCameraFrame,
} from '@/apps/persona-executor/media';

jest.mock('@/apps/persona-executor/webdriver');
jest.mock('@/apps/persona-executor/android');

let describeLinux = describe;
if (process.platform !== 'linux') describeLinux = describe.skip;

describeLinux('NAS persona executor HTTP contract (Linux fsync/rename)', () => {
  const artifacts = resolve(
    '../../.kt-workspace/test-artifacts/persona-bot-automation-20260910',
  );
  const token = 't'.repeat(32);
  let root: string, base: string, server: Server, avatar: Buffer;
  let currentName: string, uncertain: boolean, modifications: number;
  let api: jest.Mock;

  beforeEach(async () => {
    await mkdir(artifacts, { recursive: true });
    root = await mkdtemp(join(artifacts, 'executor-'));
    const canvas = new Canvas(16, 16);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff6600';
    context.fillRect(0, 0, 16, 16);
    avatar = (await normalizeAvatar(await canvas.toBuffer('png'))).png;
    currentName = '当前';
    uncertain = false;
    modifications = 0;
    jest
      .spyOn(OfficialProfileReader.prototype, 'read')
      .mockImplementation(async () => ({
        name: currentName,
        avatar: 'https://gchat.qpic.cn/current.png',
        uin: '4013209631',
      }));
    const originalTimeout = global.setTimeout;
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback, delay, ...args) => {
        if (delay === 1500) return originalTimeout(callback, 0, ...args);
        return originalTimeout(callback, delay, ...args);
      });
    api = jest.fn(async (path: string, body: any) => {
      if (path.endsWith('/query'))
        return {
          status: 200,
          data: {
            retcode: 0,
            data: {
              base_info: {
                bot_appid: '1905461123',
                bot_uin: '4013209631',
                bot_name: currentName,
                bot_avatar: 'https://gchat.qpic.cn/current.png',
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
              upload_url: 'https://example.cos.ap-guangzhou.myqcloud.com/test',
              upload_id: 'upload-test',
            },
          },
        };
      if (path.endsWith('/modify')) {
        modifications++;
        if (uncertain) return { status: 0, data: {} };
        currentName = body.name;
        return { status: 200, data: { retcode: 0 } };
      }
      throw new Error('Unexpected path');
    });
    (BrowserSession as jest.Mock).mockImplementation(() => ({
      start: async () => {},
      navigate: async () => {},
      profileApi: api,
      upload: async () => true,
      close: async () => {},
    }));
    const executor = new PersonaExecutor({
      root,
      token,
      appId: '1905461123',
      appSecret: 'test-secret',
      adminQq: '3229486494',
      androidSerial: 'nas-android:5555',
    });
    jest
      .spyOn(executor as any, 'readPublicAvatar')
      .mockImplementation(async () => avatar);
    await executor.initialize();
    server = createServer(
      (request, response) => void executor.handle(request, response),
    );
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    base = 'http://127.0.0.1:' + address.port;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    const path = relative(artifacts, root);
    expect(path.startsWith('..')).toBe(false);
    expect(path).not.toBe('');
    await rm(root, { recursive: true, force: true });
  });
  const request = async (path: string, body?: unknown) => {
    let method = 'GET';
    if (body !== undefined) method = 'POST';
    const response = await fetch(base + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  const waitJob = async (id: string, status: string) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const job = JSON.parse(
        await readFile(join(root, 'jobs', id + '.json'), 'utf8'),
      );
      if (job.status === status && !(await request('/health')).data.busy) {
        return job;
      }
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error('Job did not reach expected state');
  };

  it('persists image bytes, authenticates requests and performs one mutation for one operation identity', async () => {
    expect((await fetch(base + '/health')).status).toBe(401);
    expect(
      (
        await request('/v1/avatars', {
          image: Buffer.from('<svg/>').toString('base64'),
        })
      ).status,
    ).toBe(400);
    const stored = await request('/v1/avatars', {
      image: avatar.toString('base64'),
    });
    expect(stored.status).toBe(200);
    expect(
      await readFile(join(root, 'avatars', stored.data.hash + '.png')),
    ).toEqual(avatar);
    const input = {
      id: randomUUID(),
      name: '目标人格',
      avatarHash: stored.data.hash,
    };
    expect((await request('/v1/jobs', input)).status).toBe(202);
    expect((await waitJob(input.id, 'applied')).detail).toContain('读回一致');
    expect((await request('/v1/jobs', input)).data.status).toBe('applied');
    expect(
      (await request('/v1/jobs', { ...input, name: '另一个人格' })).status,
    ).toBe(409);
    expect(modifications).toBe(1);
  });

  it('does not repeat an ambiguous submission when its status is checked', async () => {
    uncertain = true;
    const stored = await request('/v1/avatars', {
      image: avatar.toString('base64'),
    });
    const input = {
      id: randomUUID(),
      name: '目标人格',
      avatarHash: stored.data.hash,
    };
    await request('/v1/jobs', input);
    await waitJob(input.id, 'uncertain');
    await request('/v1/jobs/' + input.id);
    await waitJob(input.id, 'uncertain');
    expect(modifications).toBe(1);
    expect(
      (await request('/v1/jobs', { ...input, id: randomUUID() })).status,
    ).toBe(409);
  });

  it('rejects a different administrator before uploading or modifying profile', async () => {
    api.mockResolvedValue({
      status: 200,
      data: {
        retcode: 0,
        data: {
          base_info: {
            bot_appid: '1905461123',
            bot_name: '原名',
            bot_avatar: 'https://gchat.qpic.cn/current.png',
          },
          developer_info: { admin_uin: '11111111' },
        },
      },
    });
    const stored = await request('/v1/avatars', {
      image: avatar.toString('base64'),
    });
    const input = {
      id: randomUUID(),
      name: '目标人格',
      avatarHash: stored.data.hash,
    };
    await request('/v1/jobs', input);
    await waitJob(input.id, 'failed');
    expect(api.mock.calls.map(([path]) => path)).toEqual([
      '/cgi-bin/v2/info/query',
    ]);
    expect(modifications).toBe(0);
  });

  it('compares actual image pixels and produces an exact GRAY8 camera frame', async () => {
    const other = new Canvas(16, 16);
    const context = other.getContext('2d');
    context.fillStyle = '#0033ff';
    context.fillRect(0, 0, 16, 16);
    expect(await avatarsMatch(avatar, avatar)).toBe(true);
    expect(await avatarsMatch(avatar, await other.toBuffer('png'))).toBe(false);
    const frame = await qrCameraFrame(avatar);
    expect(frame.length).toBe(640 * 480);
    expect(frame[0]).toBe(255);
  });
});
