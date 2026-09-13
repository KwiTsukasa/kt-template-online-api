import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BotToolController } from '@/modules/bot-adapter/core/contract/command/bot-tool.controller';
import { BotToolSessionService } from '@/modules/bot-adapter/core/application/command/bot-tool-session.service';
import { readToolResultPage } from '@/modules/bot-adapter/core/application/command/bot-tool-result';

describe('完整长命令结果读取', () => {
  it('真实HTTP返回分段入口，重建服务后按原授权回读且不重跑命令', async () => {
    const records = new Map<string, unknown>();
    const store = {
      read: async (key: string) => records.get(key),
      write: async (key: string, value: unknown) => {
        records.set(key, value);
      },
    };
    const permissions = {
      isBlocked: jest.fn().mockResolvedValue(false),
      isAllowed: jest.fn().mockResolvedValue(true),
    };
    const output = {
      events: Array.from({ length: 400 }, (_, i) => ({
        timestamp: i * 1000,
        action: '闪耀😀'.repeat(30),
      })),
    };
    const commands = {
      isReadOnlyForTools: async () => true,
      executeForTools: jest
        .fn()
        .mockResolvedValue({ status: 'success', output }),
    };
    const create = () =>
      new BotToolSessionService(
        permissions as never,
        commands as never,
        undefined,
        undefined,
        undefined,
        undefined,
        store as never,
        {
          require: () => ({ listBoundPluginKeys: async () => ['research'] }),
        } as never,
      );
    let service = create();
    const message = {
      selfId: 'bot',
      targetId: 'group',
      userId: 'member',
      messageType: 'group',
      messageId: 'incoming',
      messageText: 'read',
      rawMessage: 'read',
      rawEvent: {},
      eventTime: new Date(),
      connectionMode: 'official-websocket',
    } as const;
    const contextId = '00000000-0000-4000-8000-000000000001';
    await service.openDurable(
      contextId,
      message,
      Date.now() + 60000,
      'research',
    );
    const module = await Test.createTestingModule({
      controllers: [BotToolController],
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({ HERMES_AGENT_API_KEY: 'test-only' }),
        },
        {
          provide: BotToolSessionService,
          useValue: {
            call: (id: string, input: Record<string, unknown>) =>
              service.call(id, input),
          },
        },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const call = async (body: Record<string, unknown>) => {
      const response = await fetch((await app.getUrl()) + '/bot/tools/call', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-only',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contextId, ...body }),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      const first = await call({
        action: 'run',
        commandId: 'test',
        text: '/read',
      });
      expect(first.status).toBe(200);
      expect(first.body.result).toMatchObject({
        kind: 'paged_result',
        structure: { output: { events: { type: 'array', length: 400 } } },
      });
      expect(JSON.stringify(first.body).length).toBeLessThan(12000);
      service = create();
      let offset: number | null = 0;
      let text = '';
      while (offset !== null) {
        const page = await call({
          action: 'result',
          resultId: first.body.result.resultId,
          path: ['output', 'events'],
          offset,
          limit: 8000,
        });
        expect(page.status).toBe(200);
        text += page.body.result.text;
        offset = page.body.result.nextOffset;
      }
      expect(JSON.parse(text)).toEqual(output.events);
      expect(commands.executeForTools).toHaveBeenCalledTimes(1);
      const other = '00000000-0000-4000-8000-000000000002';
      await service.openDurable(
        other,
        { ...message, targetId: 'other-group' },
        Date.now() + 60000,
        'research',
      );
      expect(
        (
          await call({
            contextId: other,
            action: 'result',
            resultId: first.body.result.resultId,
          })
        ).status,
      ).toBe(403);
      permissions.isAllowed.mockResolvedValue(false);
      expect(
        (await call({ action: 'result', resultId: first.body.result.resultId }))
          .status,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('拒绝原型路径和越界页长，并保证单字符分页不会卡在代理对', () => {
    expect(() => readToolResultPage({}, { path: ['__proto__'] })).toThrow();
    expect(() => readToolResultPage({}, { limit: 9000 })).toThrow();
    const page = readToolResultPage('😀', { offset: 1, limit: 1 });
    expect(page.text).toBe('😀');
    expect(page.nextOffset).toBe(3);
  });
});
