jest.mock(
  '@/modules/bot-adapter/core/application/command/bot-command.service',
  () => ({ BotCommandService: class {} }),
);
jest.mock(
  '@/modules/bot-adapter/core/application/send/bot-send.service',
  () => ({ BotSendService: class {} }),
);
jest.mock(
  '@/modules/bot-adapter/core/application/account/bot-account.service',
  () => ({ BotAccountService: class {} }),
);

import { createHash } from 'node:crypto';
import { toBotPluginMessageEvent } from '@/modules/bot-adapter/core/application/event/plugin-event.mapper';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PluginWorkerThreadDriver } from '@/modules/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory';
import type { Repository } from 'typeorm';
import { ToolsService } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { BotCommandController } from '@/modules/bot-adapter/core/contract/command/bot-command.controller';
import { BotCommandEngineService } from '@/modules/bot-adapter/core/application/command/bot-command-engine.service';
import { BotCommandParserService } from '@/modules/bot-adapter/core/application/command/bot-command-parser.service';
import { BotCommandService } from '@/modules/bot-adapter/core/application/command/bot-command.service';
import { BotReplyTemplateService } from '@/modules/bot-adapter/core/application/command/bot-reply-template.service';
import { PluginHostBridgeService } from '@/modules/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service';
import { PluginHttpClientService } from '@/modules/plugin-platform/infrastructure/integration/sdk/plugin-http-client.service';
import type { PluginPackageDescriptor } from '@/modules/plugin-platform/infrastructure/integration/package/plugin-package.types';
import { Plugin } from '@/modules/plugin-platform/infrastructure/persistence/plugin-platform.entities';
import { createPlugin } from '@/modules/plugins/persona-switch/src';
import {
  readState,
  savePersona,
} from '@/modules/plugins/persona-switch/src/state';

const manifest = JSON.parse(
  readFileSync('src/modules/plugins/persona-switch/plugin.json', 'utf8'),
);
const botContext = {
  bot: { selfId: 'qq-official:1020000001' },
  conversation: { key: 'a'.repeat(64), scope: 'group' },
};
const otherContext = {
  ...botContext,
  conversation: { key: 'b'.repeat(64), scope: 'group' },
};
const command = {
  aliases: '["persona","人格"]',
  code: 'persona_switch',
  cooldownMs: 0,
  defaultParams: '{}',
  enabled: true,
  id: '2041700000000300519',
  name: '人格',
  operationKey: 'persona.manage',
  pluginKey: 'persona-switch',
  prefixes: '["/"]',
  targetType: 'all',
};

const createStore = () => {
  const rows = new Map<string, any>();
  let tail: Promise<unknown> = Promise.resolve();
  const findOne = jest.fn(async (_entity, options) => {
    expect(options.lock).toEqual({ mode: 'pessimistic_write' });
    return { id: options.where.pluginKey, status: 'enabled' };
  });
  const repository = {
    manager: {
      transaction: async (work) => {
        const current = tail.then(() =>
          work({
            findOne,
            getRepository: () => ({
              findOne: async ({ where }) =>
                structuredClone(rows.get(where.pluginId) ?? null),
              create: (value) => ({ ...value }),
              save: async (value) => {
                rows.set(value.pluginId, structuredClone(value));
                return value;
              },
            }),
          }),
        );
        tail = current.catch(() => undefined);
        return current;
      },
    },
  } as unknown as Repository<Plugin>;
  const bridge = new PluginHostBridgeService(
    {} as any,
    Object.assign(new PluginHttpClientService(), {
      requestResponse: async (input: any) => {
        if (
          String(input.url).startsWith('https://gchat.qpic.cn/') ||
          String(input.url).startsWith('https://multimedia.nt.qq.com/') ||
          String(input.url).startsWith('https://multimedia.nt.qq.com.cn/')
        )
          return {
            body: Buffer.from('test-avatar'),
            statusCode: 200,
            headers: {},
          };
        return new PluginHttpClientService().requestResponse(input);
      },
    }),
    undefined,
    repository,
  );
  const host = (key = 'persona-switch', permissions = manifest.permissions) =>
    Object.fromEntries(
      ['readPluginState', 'compareAndSwapPluginState', 'requestResponse'].map(
        (method) => [
          method,
          async (input?: unknown) => {
            let args = {};
            if (method === 'requestResponse') args = { options: input };
            else if (method === 'compareAndSwapPluginState') args = { input };
            const result = await bridge.handleHostCall(
              {
                manifest: { ...manifest, pluginKey: key, permissions },
              } as PluginPackageDescriptor,
              { method, args, pluginKey: 'untrusted-other-key' },
            );
            if (result.ok === false) throw new Error(result.message);
            return result.value;
          },
        ],
      ),
    );
  return { rows, host, findOne, bridge };
};

describe('persona state and native Hermes synchronization', () => {
  let server: Server;
  let base: string;
  let soul: string;
  let projection: any;
  let digest: string;
  let readsFail: boolean;
  let failAfterPut: boolean;
  let puts: number;
  let requests: number;
  let store: ReturnType<typeof createStore>;
  const makePlugin = () =>
    createPlugin({
      host: store.host(),
      manifest,
      runtime: {
        configSnapshot: {
          HERMES_DASHBOARD_BASE_URL: base,
          HERMES_DASHBOARD_USERNAME: 'test-user',
          HERMES_DASHBOARD_PASSWORD: 'test-password',
          PERSONA_EXECUTOR_BASE_URL: base,
          PERSONA_EXECUTOR_TOKEN: 'x'.repeat(32),
        },
      },
    });

  beforeEach(async () => {
    soul = '';
    projection = null;
    digest = '';
    readsFail = false;
    failAfterPut = false;
    puts = 0;
    requests = 0;
    store = createStore();
    server = createServer(async (request, response) => {
      requests++;
      let body = '';
      for await (const chunk of request) body += chunk;
      response.setHeader('content-type', 'application/json');
      if (request.url === '/v1/avatars') {
        expect(request.headers.authorization).toBe('Bearer ' + 'x'.repeat(32));
        response.end(JSON.stringify({ hash: 'a'.repeat(64) }));
        return;
      }
      if (request.url === '/v1/jobs') {
        const job = JSON.parse(body);
        response.end(
          JSON.stringify({
            id: job.id,
            botSelfId: job.botSelfId,
            status: 'applied',
            verifiedBy: 'qq-openapi-v1',
            detail: 'Bot 昵称和头像已读回一致。',
          }),
        );
        return;
      }
      if (request.headers.origin !== base) {
        response.writeHead(403).end('{}');
        return;
      }
      if (request.url === '/auth/password-login') {
        expect(JSON.parse(body)).toMatchObject({
          provider: 'basic',
          username: 'test-user',
          password: 'test-password',
        });
        response.setHeader('set-cookie', [
          'hermes_session=test; HttpOnly; Path=/',
          'hermes_provider=basic; Path=/',
        ]);
        response.end('{"ok":true}');
        return;
      }
      if (
        request.headers.cookie !== 'hermes_session=test; hermes_provider=basic'
      ) {
        response.writeHead(401).end('{}');
        return;
      }
      expect(request.url).toBe('/api/profiles/default/conversation-souls');
      if (request.method === 'PUT') {
        puts++;
        projection = JSON.parse(body);
        digest = createHash('sha256').update(body).digest('hex');
        const selected =
          Object.values(projection.bindings)[0] || projection.fallback;
        soul = projection.souls[String(selected)];
        if (failAfterPut) readsFail = true;
        response.end(
          JSON.stringify({ ok: true, revision: projection.revision, digest }),
        );
        return;
      }
      if (readsFail) {
        response.writeHead(503).end('{}');
        return;
      }
      response.end(
        JSON.stringify({ revision: projection?.revision || 0, digest }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('missing listener');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each(['multimedia.nt.qq.com', 'multimedia.nt.qq.com.cn'])(
    'saves the first signed attachment from %s without switching persona',
    async (hostname) => {
      const calls = jest.spyOn(store.bridge, 'handleHostCall');
      const imageUrl = `https://${hostname}/download?appid=1407&fileid=first&rkey=signed-test-key`;
      const content = '我是柊司。\n【我的日常】\n我喜欢做点心。';
      const result = await makePlugin().operations[0].execute({
        raw: 's\n柊司\n' + content,
        imageUrls: [imageUrl, 'https://gchat.qpic.cn/second.png'],
      });
      expect(result.replyText).toContain('已保存 柊司');
      const state = store.rows.get('persona-switch').configValue.value;
      expect(state.profiles).toContainEqual({
        name: '柊司',
        content,
        version: 1,
        avatar: { hash: 'a'.repeat(64) },
      });
      expect(state.versions[state.fallback].name).toBe('默认');
      expect(state.bindings).toEqual({});
      expect(state.botProfile).toBeUndefined();
      const downloaded = calls.mock.calls
        .map(([, call]) => call)
        .filter((call) => call.method === 'requestResponse');
      expect(downloaded).toHaveLength(2);
      expect(downloaded[0].args).toEqual({
        options: {
          url: imageUrl,
          method: 'GET',
          timeoutMs: 8000,
          maxResponseBytes: 2 * 1024 * 1024,
          context: '人格头像读取',
        },
      });
      expect(requests).toBe(1);
      expect(puts).toBe(0);
      expect(soul).toBe('');
    },
  );

  it('rejects a lookalike QQ attachment domain before downloading or writing', async () => {
    const calls = jest.spyOn(store.bridge, 'handleHostCall');
    const result = await makePlugin().operations[0].execute({
      raw: 's\n柊司\n正文',
      imageUrls: ['https://multimedia.nt.qq.com.cn.example.com/download'],
    });
    expect(result.replyText).toContain('保存未成功');
    expect(store.rows.size).toBe(0);
    expect(requests).toBe(0);
    expect(
      calls.mock.calls.some(([, call]) => call.method === 'requestResponse'),
    ).toBe(false);
  });

  it('takes the conversation only from trusted host context and never creates a global profile job', async () => {
    const plugin = makePlugin();
    await plugin.operations[0].execute({
      raw: 's A\n正文',
      imageUrls: ['https://gchat.qpic.cn/first.png'],
    });
    const input = {
      raw: 'c A',
      conversation: otherContext.conversation,
      scope: 'b'.repeat(64),
    };
    expect((await plugin.operations[0].execute(input)).replyText).toContain(
      '缺少可信会话',
    );
    expect(puts).toBe(0);
    await plugin.operations[0].execute(input, botContext);
    const state = store.rows.get('persona-switch').configValue.value;
    expect(Object.keys(state.bindings)).toEqual([botContext.conversation.key]);
    expect(state.botProfile).toBeUndefined();
    expect(projection.bindings[botContext.conversation.key]).toBeDefined();
    expect(projection.bindings[otherContext.conversation.key]).toBeUndefined();
  });

  it('uses both command aliases through the real API HTTP controller and keeps drafts separate from SOUL', async () => {
    const plugin = makePlugin();
    const commands = {
      findById: jest.fn().mockResolvedValue(command),
      isInCooldown: () => false,
      listEnabledForMessage: async () => [command],
      logExecution: jest.fn(),
      markHit: jest.fn(),
      parseDefaultParams: () => ({}),
      toResponse: (value) => value,
    };
    const send = { sendText: jest.fn() };
    const engine = new BotCommandEngineService(
      new BotCommandParserService(),
      commands as any,
      {
        executeOperation: ({ input, context }) =>
          plugin.operations[0].execute(input, context),
      } as any,
      new BotReplyTemplateService(),
      send as any,
      new ToolsService(),
    );
    const module = await Test.createTestingModule({
      controllers: [BotCommandController],
      providers: [
        { provide: BotCommandEngineService, useValue: engine },
        { provide: BotCommandService, useValue: commands },
        { provide: ToolsService, useValue: new ToolsService() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const execute = async (text: string) => {
        const response = await fetch(`${await app.getUrl()}/bot/command/test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            commandId: command.id,
            selfId: botContext.bot.selfId,
          }),
          signal: AbortSignal.timeout(6000),
        });
        expect(response.status).toBe(200);
        const result = (await response.json()).data;
        expect(result.matched).toBe(true);
        return result.replyText;
      };
      expect(await execute('/persona')).toContain('/人格');
      expect(await execute('/persona s A\n正文')).toContain('缺少图片');
      expect(store.rows.size).toBe(0);
      expect(
        (
          await plugin.operations[0].execute({
            raw: 's 简洁\n第一行\n第二行',
            imageUrls: ['https://gchat.qpic.cn/first.png'],
          })
        ).replyText,
      ).toContain('已保存');
      expect(soul).toBe('');
      expect(await execute('/人格 c 简洁')).toContain(
        '当前会话人格已选择：简洁',
      );
      expect(soul).toBe('第一行\n第二行');
      expect(await execute('/persona h')).toContain('当前会话人格：简洁');
      expect(await execute('/persona d 简洁')).toContain('仍被某个会话');
      expect(await execute('/persona 保存 错误 单行正文')).toContain(
        '缺少图片',
      );
      expect(send.sendText).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('recovers an unconfirmed selection after restart without blocking a different group', async () => {
    const plugin = makePlugin();
    const execute = (raw, context = botContext) =>
      plugin.operations[0].execute(
        { raw, imageUrls: ['https://gchat.qpic.cn/first.png'] },
        context,
      );
    await execute('保存 A\n第一人格');
    await execute('保存 B\n第二人格');
    failAfterPut = true;
    expect((await execute('切换 A')).replyText).toContain('未确认成功');
    expect((await execute('h')).replyText).toContain('人格待同步：A');
    let state = store.rows.get('persona-switch').configValue.value;
    expect(
      state.versions[state.bindings[botContext.conversation.key].current].name,
    ).toBe('默认');
    readsFail = false;
    failAfterPut = false;
    expect((await execute('切换 B', otherContext)).replyText).toContain(
      '已选择：B',
    );
    expect((await execute('h')).replyText).toContain('当前会话人格：A');
    const restarted = makePlugin();
    expect(await restarted.activate()).toEqual({ synchronized: true });
    expect(
      (await restarted.operations[0].execute({ raw: 'h' }, otherContext))
        .replyText,
    ).toContain('当前会话人格：B');
    const count = requests;
    await restarted.tasks[0].execute();
    expect(requests).toBe(count);
    state = store.rows.get('persona-switch').configValue.value;
    expect(state.soulRevision).toBe(state.publishedRevision);
  });

  it('merges concurrent switches across groups and keeps private chats independent', async () => {
    const first = makePlugin();
    for (const name of ['A', 'B'])
      await first.operations[0].execute({
        raw: '保存 ' + name + '\n正文' + name,
        imageUrls: ['https://gchat.qpic.cn/first.png'],
      });
    await Promise.all([
      first.operations[0].execute({ raw: '切换 A' }, botContext),
      makePlugin().operations[0].execute({ raw: '切换 B' }, otherContext),
    ]);
    await makePlugin().activate();
    expect(
      (await first.operations[0].execute({ raw: 'h' }, botContext)).replyText,
    ).toContain('当前会话人格：A');
    expect(
      (await first.operations[0].execute({ raw: 'h' }, otherContext)).replyText,
    ).toContain('当前会话人格：B');
    const direct = { conversation: { key: 'c'.repeat(64), scope: 'direct' } };
    const another = { conversation: { key: 'd'.repeat(64), scope: 'direct' } };
    await first.operations[0].execute({ raw: '切换 B' }, direct);
    expect(
      (await first.operations[0].execute({ raw: 'h' }, another)).replyText,
    ).toContain('当前会话人格：默认');
    expect(
      (await first.operations[0].execute({ raw: 'h' }, botContext)).replyText,
    ).toContain('当前会话人格：A');
    const stored = store.rows.get('persona-switch').configValue.value;
    expect(Object.keys(stored.versions)).toHaveLength(3);
    expect(stored.publishedRevision).toBe(stored.soulRevision);
  });

  it('migrates the previous shared selection into a preserved fallback without repeating old global jobs', async () => {
    const selected = {
      name: '旧人格',
      content: '原文不改',
      version: 7,
      avatar: { hash: 'a'.repeat(64) },
    };
    await store.host().compareAndSwapPluginState({
      expectedRevision: 0,
      value: {
        schemaVersion: 1,
        profiles: [{ name: '默认', content: '', version: 0 }, selected],
        current: selected,
        previous: null,
        pending: null,
      },
    });
    const plugin = makePlugin();
    expect(await plugin.activate()).toEqual({ synchronized: true });
    expect(soul).toBe('原文不改');
    for (const context of [botContext, otherContext])
      expect(
        (await plugin.operations[0].execute({ raw: 'h' }, context)).replyText,
      ).toContain('当前会话人格：旧人格');
    const stored = store.rows.get('persona-switch').configValue.value;
    expect(stored.schemaVersion).toBe(2);
    expect(stored.versions[stored.fallback]).toEqual(selected);
    expect(stored.profiles).toContainEqual(selected);
  });

  it('uses one group key for all members but separates bot accounts, groups and private targets', () => {
    const message = {
      selfId: 'qq-official:1',
      messageType: 'group',
      targetId: 'group1',
      userId: 'u1',
      messageId: 'm',
      messageText: '',
      rawMessage: '',
      rawEvent: {},
      eventTime: new Date(),
    } as any;
    const key = (change) =>
      toBotPluginMessageEvent({ ...message, ...change }).conversationKey;
    expect(key({ userId: 'u2' })).toBe(key({}));
    expect(key({ targetId: 'group2' })).not.toBe(key({}));
    expect(key({ selfId: 'qq-official:2' })).not.toBe(key({}));
    expect(key({ messageType: 'private', targetId: 'u1' })).not.toBe(
      key({ messageType: 'private', targetId: 'u2' }),
    );
  });

  it('isolates storage identity and permissions and rejects corrupt or oversized writes', async () => {
    const a = store.host();
    const b = store.host('another');
    await a.compareAndSwapPluginState({
      expectedRevision: 0,
      value: { data: 'own state' },
    });
    expect(await b.readPluginState()).toEqual({ revision: 0, value: null });
    await expect(
      a.compareAndSwapPluginState({ expectedRevision: 0, value: {} }),
    ).rejects.toThrow('版本冲突');
    await expect(
      store.host('persona-switch', []).readPluginState(),
    ).rejects.toThrow('权限');
    await expect(
      a.compareAndSwapPluginState({
        expectedRevision: 1,
        value: { text: 'x'.repeat(49 * 1024) },
      }),
    ).rejects.toThrow('48 KiB');
    store.rows.get('persona-switch').configValue = { value: { corrupt: true } };
    await expect(a.readPluginState()).rejects.toThrow('损坏');
  });

  it('rejects malformed domain state and protects the empty default persona', () => {
    expect(() => readState({})).toThrow();
    const initial = readState(null);
    expect(() => savePersona(initial, '默认', '不能覆盖')).toThrow('默认');
    expect(() => savePersona(initial, '../escape', '正文')).toThrow();
    expect(() => savePersona(initial, 'A', '')).toThrow();
    expect(() => savePersona(initial, 'A', 'x'.repeat(8001))).toThrow();
  });

  it('loads the actual TypeScript package in a worker and carries storage plus authenticated HTTP through the host bridge', async () => {
    const descriptor = {
      entry: 'src/index.ts',
      entryFile: resolve('src/modules/plugins/persona-switch/src/index.ts'),
      manifest,
      packageRoot: resolve('src/modules/plugins/persona-switch'),
      pluginKey: 'persona-switch',
    };
    const driver = new PluginWorkerThreadDriver(store.bridge, {
      descriptor,
      installationId: 'synthetic-worker',
      pluginKey: 'persona-switch',
      configSnapshot: {
        HERMES_DASHBOARD_BASE_URL: base,
        HERMES_DASHBOARD_USERNAME: 'test-user',
        HERMES_DASHBOARD_PASSWORD: 'test-password',
        PERSONA_EXECUTOR_BASE_URL: base,
        PERSONA_EXECUTOR_TOKEN: 'x'.repeat(32),
      },
    });
    let sequence = 0;
    const request = (input: Record<string, unknown>) =>
      driver.request({
        correlationId: String(++sequence),
        pluginKey: 'persona-switch',
        timeoutMs: 15000,
        type: 'executeOperation',
        context: botContext,
        operationKey: 'persona.manage',
        ...input,
      });
    try {
      await request({ type: 'load' });
      await request({ type: 'activate' });
      const saved = await request({
        input: {
          raw: 's Worker\n工作线程正文',
          imageUrls: ['https://gchat.qpic.cn/first.png'],
        },
      });
      expect(saved).toMatchObject({
        replyText: expect.stringContaining('已保存'),
      });
      const switched = await request({ input: { raw: 'c Worker' } });
      expect(switched).toMatchObject({
        replyText: expect.stringContaining('当前会话人格已选择'),
      });
      expect(soul).toBe('工作线程正文');
      expect(await request({ input: { raw: 'constructor' } })).toMatchObject({
        replyText: expect.stringContaining('/persona h'),
      });
      expect(
        await request({
          type: 'executeTask',
          taskKey: 'persona.reconcile',
          taskHandlerName: 'reconcile',
        }),
      ).toEqual({ synchronized: true });
    } finally {
      await driver.dispose();
    }
  }, 20000);
});
