import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createServer } from 'node:http';
import { TencentBotProfileController } from '@/modules/bot-adapter/tencent/contract/tencent-bot-profile.controller';
import { TencentBotService } from '@/modules/bot-adapter/tencent/infrastructure/tencent-bot.service';
import { PersonaExecutor } from '@/apps/persona-executor/server';

describe('account-bound profile HTTP routes', () => {
  const token = 'test-service-token-'.repeat(3);
  const first = 'qq-official:1020000001';
  const second = 'qq-official:1020000002';

  it('authenticates real HTTP profile reads and never uses a default bot for missing identity', async () => {
    const readOwnProfile = jest.fn(async (selfId) => ({
      selfId,
      name: '测试资料',
    }));
    const module = await Test.createTestingModule({
      controllers: [TencentBotProfileController],
      providers: [
        { provide: ConfigService, useValue: { get: () => token } },
        { provide: TencentBotService, useValue: { readOwnProfile } },
      ],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const url = (await app.getUrl()) + '/bot-adapter/tencent/profile/read';
      const send = async (body: unknown, credential = token) =>
        fetch(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + credential,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(3000),
        });
      expect((await send({ selfId: first }, 'wrong')).status).toBe(401);
      expect((await send({ appId: '1020000001' })).status).toBe(400);
      expect(readOwnProfile).not.toHaveBeenCalled();
      for (const selfId of [first, second]) {
        const response = await send({ selfId });
        expect(response.status).toBe(200);
        expect((await response.json()).selfId).toBe(selfId);
      }
      expect(readOwnProfile.mock.calls).toEqual([[first], [second]]);
    } finally {
      await app.close();
    }
  });

  it('rejects attempts to rebind a persisted job to a different account through HTTP', async () => {
    const executor = new PersonaExecutor({
      root: 'unused',
      token,
      apiBaseUrl: 'http://127.0.0.1',
      adminQq: '123456789',
      androidSerial: 'unused',
    });
    const jobs = new Map<string, any>();
    jest
      .spyOn(executor as any, 'readJob')
      .mockImplementation(async (id) => jobs.get(String(id)));
    jest
      .spyOn(executor as any, 'persist')
      .mockImplementation(async (job: any) => {
        jobs.set(job.id, structuredClone(job));
      });
    jest
      .spyOn(executor as any, 'avatar')
      .mockResolvedValue(Buffer.from('verified-avatar'));
    jest.spyOn(executor as any, 'launch').mockImplementation(() => undefined);
    const server = createServer(
      (request, response) => void executor.handle(request, response),
    );
    try {
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('listener missing');
      const url = `http://127.0.0.1:${address.port}/v1/jobs`;
      const input = {
        id: 'e2430c81-d392-4003-8e02-abcf9afa70dd',
        name: '测试',
        avatarHash: 'a'.repeat(64),
      };
      const post = async (body: unknown) =>
        fetch(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(3000),
        });
      expect((await post(input)).status).toBe(400);
      expect((await post({ ...input, botSelfId: first })).status).toBe(202);
      expect((await post({ ...input, botSelfId: second })).status).toBe(409);
      const repeated = await post({ ...input, botSelfId: first });
      expect(repeated.status).toBe(200);
      expect((await repeated.json()).botSelfId).toBe(first);
      expect(jobs.get(input.id).botSelfId).toBe(first);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      jest.restoreAllMocks();
    }
  });
});
