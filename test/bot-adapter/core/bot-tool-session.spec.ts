import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { BotToolController } from '@/modules/bot-adapter/core/contract/command/bot-tool.controller';
import { BotToolSessionService } from '@/modules/bot-adapter/core/application/command/bot-tool-session.service';
import { BotCommandEngineService } from '@/modules/bot-adapter/core/application/command/bot-command-engine.service';
import { BotCommandParserService } from '@/modules/bot-adapter/core/application/command/bot-command-parser.service';

const message = {
  selfId: 'qq-official:1',
  messageType: 'group',
  targetId: 'group',
  userId: 'sender',
  messageId: 'event',
  messageText: '查状态',
  rawMessage: '查状态',
  rawEvent: {},
  eventTime: new Date(),
} as const;

describe('Bot conversation tool authorization', () => {
  const permissions = { isBlocked: jest.fn(), isAllowed: jest.fn() };
  const commands = { listForTools: jest.fn(), executeForTools: jest.fn() };
  let service: BotToolSessionService;
  beforeEach(() => {
    jest.resetAllMocks();
    permissions.isBlocked.mockResolvedValue(false);
    permissions.isAllowed.mockResolvedValue(true);
    commands.listForTools.mockResolvedValue([{ commandId: '1' }]);
    commands.executeForTools.mockResolvedValue({ status: 'success' });
    service = new BotToolSessionService(
      permissions as never,
      commands as never,
    );
  });

  it('refreshes bindings and retains the original sender, ignoring forged identity fields', async () => {
    const refreshPluginKeys = jest.fn().mockResolvedValue(['status']);
    const id = service.open(message, {
      pluginKeys: ['old'],
      refreshPluginKeys,
    });
    await service.call(id, {
      action: 'run',
      commandId: '1',
      text: '/status',
      selfId: 'admin',
      userId: 'owner',
    });
    expect(commands.executeForTools).toHaveBeenCalledWith(
      message,
      expect.objectContaining({ pluginKeys: ['status'] }),
      '1',
      '/status',
    );
    expect(refreshPluginKeys).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent identical executions and rechecks revoked permissions', async () => {
    const id = service.open(message);
    const input = { action: 'run', commandId: '1', text: '/status' };
    await Promise.all([service.call(id, input), service.call(id, input)]);
    expect(commands.executeForTools).toHaveBeenCalledTimes(1);
    permissions.isBlocked.mockResolvedValue(true);
    await expect(service.call(id, input)).rejects.toThrow('权限');
  });

  it('rejects expired, closed and unknown contexts before dispatching', async () => {
    const id = service.open(message);
    service.close(id);
    await expect(service.call(id, { action: 'list' })).rejects.toThrow('失效');
    await expect(service.call('unknown', { action: 'list' })).rejects.toThrow(
      '失效',
    );
    const expiring = service.open(message);
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 241000);
    await expect(service.call(expiring, { action: 'list' })).rejects.toThrow(
      '失效',
    );
    now.mockRestore();
    expect(commands.listForTools).not.toHaveBeenCalled();
  });

  it('serves a real local HTTP request with credential and context checks', async () => {
    const module = await Test.createTestingModule({
      controllers: [BotToolController],
      providers: [
        { provide: ConfigService, useValue: { get: () => 'test-service-key' } },
        { provide: BotToolSessionService, useValue: service },
      ],
    }).compile();
    const app: INestApplication = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    try {
      const url = `${await app.getUrl()}/bot/tools/call`;
      const id = service.open(message);
      const bad = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: id, action: 'list' }),
      });
      expect(bad.status).toBe(401);
      const good = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-service-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contextId: id, action: 'list' }),
      });
      expect(good.status).toBe(200);
      expect(await good.json()).toEqual({ result: [{ commandId: '1' }] });
      service.close(id);
      const closed = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-service-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contextId: id, action: 'list' }),
      });
      expect(closed.status).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('Bot command tool execution', () => {
  const command = {
    id: '7',
    code: 'status',
    name: '状态',
    prefixes: '/',
    aliases: 'status',
    pluginKey: 'status',
    operationKey: 'status.read',
    cooldownMs: 0,
  };
  const catalog = {
    listEnabledForMessage: jest.fn(),
    isInCooldown: jest.fn(),
    parseDefaultParams: jest.fn(),
    markHit: jest.fn(),
    logExecution: jest.fn(),
  };
  const plugins = {
    getOperationByCommand: jest.fn(),
    executeOperation: jest.fn(),
  };
  const engine = new BotCommandEngineService(
    new BotCommandParserService(plugins as never),
    catalog as never,
    plugins as never,
    { render: () => '', stringifyOutput: () => '正常' } as never,
    {} as never,
    { getErrorMessage: () => '失败' } as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    catalog.listEnabledForMessage.mockResolvedValue([command]);
    catalog.isInCooldown.mockReturnValue(false);
    catalog.parseDefaultParams.mockReturnValue({});
    plugins.getOperationByCommand.mockResolvedValue({
      key: 'status.read',
      aliases: ['status'],
    });
    plugins.executeOperation.mockResolvedValue({ ok: true });
  });
  it('uses original parsing and records execution without sending a second QQ message', async () => {
    await expect(
      engine.executeForTools(message, undefined, '7', '/status'),
    ).resolves.toMatchObject({ status: 'success', replyText: '正常' });
    expect(catalog.logExecution).toHaveBeenCalledWith(
      expect.objectContaining({ message, status: 'success' }),
    );
    expect(plugins.executeOperation).toHaveBeenCalledTimes(1);
  });
  it('rejects a disabled command, mismatched text, removed plugin or cooldown', async () => {
    await expect(
      engine.executeForTools(message, undefined, 'other', '/status'),
    ).rejects.toThrow('未启用');
    await expect(
      engine.executeForTools(message, undefined, '7', '/delete'),
    ).rejects.toThrow('不匹配');
    plugins.getOperationByCommand.mockResolvedValue(null);
    await expect(
      engine.executeForTools(message, undefined, '7', '/status'),
    ).rejects.toThrow('未启用');
    plugins.getOperationByCommand.mockResolvedValue({ key: 'status.read' });
    catalog.isInCooldown.mockReturnValue(true);
    await expect(
      engine.executeForTools(message, undefined, '7', '/status'),
    ).rejects.toThrow('冷却');
    expect(plugins.executeOperation).not.toHaveBeenCalled();
  });
});
