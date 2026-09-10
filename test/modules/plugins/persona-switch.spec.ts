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
      expect(request.url).toBe('/api/profiles/default/soul');
      if (request.method === 'PUT') {
        puts++;
        soul = JSON.parse(body).content;
        if (failAfterPut) readsFail = true;
        response.end('{"ok":true}');
        return;
      }
      if (readsFail) {
        response.writeHead(503).end('{}');
        return;
      }
      response.end(JSON.stringify({ content: soul, exists: true }));
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
      expect(state.current.name).toBe('默认');
      expect(state.pending).toBeNull();
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
        executeOperation: ({ input }) => plugin.operations[0].execute(input),
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
          body: JSON.stringify({ text, commandId: command.id }),
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
      expect(await execute('/人格 c 简洁')).toContain('共享人格已选择：简洁');
      expect(soul).toBe('第一行\n第二行');
      expect(await execute('/persona h')).toContain('Bot 昵称和头像已读回一致');
      expect(await execute('/persona d 简洁')).toContain('正在使用');
      expect(await execute('/persona 保存 错误 单行正文')).toContain(
        '缺少图片',
      );
      expect(send.sendText).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps an unconfirmed target after a successful PUT with failed verification, then recovers that target after restart', async () => {
    const plugin = makePlugin();
    const execute = (raw) =>
      plugin.operations[0].execute({
        raw,
        imageUrls: ['https://gchat.qpic.cn/first.png'],
      });
    await execute('保存 A\n待确认正文');
    await execute('保存 B\n第二个人格');
    failAfterPut = true;
    expect((await execute('切换 A')).replyText).toContain('未确认成功');
    expect(soul).toBe('待确认正文');
    expect((await execute('h')).replyText).toContain('人格待同步：A');
    expect(
      store.rows.get('persona-switch').configValue.value.current.name,
    ).toBe('默认');
    await execute('切换 B');
    expect(puts).toBe(1);
    const restarted = makePlugin();
    await restarted.activate();
    expect(puts).toBe(1);
    store.rows.get('persona-switch').configValue.value.pending.retryAfter = 0;
    readsFail = false;
    failAfterPut = false;
    await restarted.tasks[0].execute();
    expect(
      (await restarted.operations[0].execute({ raw: 'h' })).replyText,
    ).toContain('当前人格：A');
    expect(puts).toBe(1);
    const count = requests;
    await restarted.tasks[0].execute();
    expect(requests).toBe(count);
  });

  it('serializes concurrent choices through the shared API revision, including separate plugin instances', async () => {
    const first = makePlugin();
    await first.operations[0].execute({
      raw: '保存 A\n第一人格',
      imageUrls: ['https://gchat.qpic.cn/first.png'],
    });
    await first.operations[0].execute({
      raw: '保存 B\n第二人格',
      imageUrls: ['https://gchat.qpic.cn/first.png'],
    });
    const second = makePlugin();
    const results = await Promise.all([
      first.operations[0].execute({ raw: '切换 A' }),
      second.operations[0].execute({ raw: '切换 B' }),
    ]);
    expect(
      results.filter((result) => result.replyText.startsWith('共享人格已选择'))
        .length,
    ).toBe(1);
    expect(puts).toBe(1);
    const stored = store.rows.get('persona-switch').configValue.value;
    expect(stored.pending).toBeNull();
    expect(stored.current.content).toBe(soul);
  });

  it('restores API-owned selection on activation without changing the selected version or previous version', async () => {
    const plugin = makePlugin();
    await plugin.operations[0].execute({
      raw: '保存 A\n稳定正文',
      imageUrls: ['https://gchat.qpic.cn/first.png'],
    });
    await plugin.operations[0].execute({ raw: '切换 A' });
    soul = '外部修改';
    await makePlugin().activate();
    expect(soul).toBe('稳定正文');
    expect(
      store.rows.get('persona-switch').configValue.value.previous.name,
    ).toBe('默认');
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
        replyText: expect.stringContaining('共享人格已选择'),
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
