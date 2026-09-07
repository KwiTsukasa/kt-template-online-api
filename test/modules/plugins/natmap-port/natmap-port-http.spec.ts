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
import { ToolsService } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { BotCommandController } from '@/modules/bot-adapter/core/contract/command/bot-command.controller';
import { BotCommandEngineService } from '@/modules/bot-adapter/core/application/command/bot-command-engine.service';
import { BotCommandParserService } from '@/modules/bot-adapter/core/application/command/bot-command-parser.service';
import { BotCommandService } from '@/modules/bot-adapter/core/application/command/bot-command.service';
import { BotReplyTemplateService } from '@/modules/bot-adapter/core/application/command/bot-reply-template.service';
import { BotRuleEngineService } from '@/modules/bot-adapter/core/application/send/bot-rule-engine.service';
import { BotPermissionService } from '@/modules/bot-adapter/core/application/permission/bot-permission.service';
import { PluginHostBridgeService } from '@/modules/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service';
import { NatmapPortApplication } from '@/modules/plugins/natmap-port/src/application/natmap-port-application';
import type { PluginPackageDescriptor } from '@/modules/plugin-platform/infrastructure/integration/package/plugin-package.types';
import type { FindManyOptions, Repository } from 'typeorm';

const command = {
  aliases: '["natmap"]',
  code: 'natmap_port',
  cooldownMs: 0,
  defaultParams: '{}',
  enabled: true,
  id: '2041700000000300518',
  name: 'NATMap 动态端口',
  operationKey: 'natmap.port.current',
  pluginKey: 'natmap-port',
  prefixes: '["/"]',
  targetType: 'all',
};

const createHarness = () => {
  const current = {
    currentObservedAt: new Date('2026-09-07T05:00:00Z'),
    currentPublicIpv4: '203.0.113.5',
    currentPublicPort: 55505,
    currentValidUntil: new Date('2099-01-01T00:00:00Z'),
    desiredPresence: 'present',
    isDeleted: false,
    natmapDesiredEnabled: true,
    natmapStatus: 'active',
    syncStatus: 'synced',
  };
  const mappings = [
    {
      ...current,
      id: '1',
      name: 'WireGuard Hub NATMap',
      protocol: 'udp',
      externalPort: 51825,
      internalPort: 51820,
      targetIpv4: '192.168.31.81',
    },
    {
      ...current,
      id: '2',
      name: 'NAS TLS Gateway',
      protocol: 'tcp',
      currentPublicPort: 55449,
    },
    {
      ...current,
      id: '3',
      name: 'UDP Keeper',
      protocol: 'udp',
      externalPort: 8213,
      internalPort: 8213,
      keeperDesiredEnabled: true,
      natmapDesiredEnabled: false,
    },
    {
      ...current,
      id: '4',
      name: 'Unsupported UDP',
      protocol: 'udp',
      externalPort: 51826,
      internalPort: 51820,
      targetIpv4: '192.168.31.81',
    },
    {
      ...current,
      id: '5',
      name: 'Deleted TCP',
      protocol: 'tcp',
      isDeleted: true,
    },
    {
      ...current,
      id: '6',
      name: 'Disabled TCP',
      protocol: 'tcp',
      natmapDesiredEnabled: false,
    },
  ] as NetworkPortForward[];
  const repository = {
    find: jest.fn(async (options: FindManyOptions<NetworkPortForward>) => {
      const alternatives = [options.where].flat();
      const selected = mappings.filter((mapping) =>
        alternatives.some((where) =>
          Object.entries(where || {}).every(
            ([key, value]) => mapping[key] === value,
          ),
        ),
      );
      return selected.slice(0, options.take);
    }),
  };
  const descriptor = {
    manifest: { permissions: ['network.endpoint.read'] },
  } as PluginPackageDescriptor;
  const bridge = new PluginHostBridgeService(
    {} as any,
    {} as any,
    repository as unknown as Repository<NetworkPortForward>,
  );
  const application = new NatmapPortApplication({
    resolveNatmapEndpoint: async (input) => {
      const result = await bridge.handleHostCall(descriptor, {
        args: input,
        method: 'resolveNatmapEndpoint',
        pluginKey: 'natmap-port',
      });
      if (result.ok === false) throw new Error(result.message);
      return result.value;
    },
  });
  const commands = {
    findById: jest.fn(async (id) => {
      expect(id).toBe(command.id);
      return command;
    }),
    isInCooldown: jest.fn(() => false),
    listEnabledForMessage: jest.fn().mockResolvedValue([command]),
    logExecution: jest.fn(),
    markHit: jest.fn(),
    parseDefaultParams: jest.fn(() => ({})),
    toResponse: jest.fn((value) => value),
  };
  const plugins = {
    executeOperation: jest.fn(async ({ input }) => application.query(input)),
  };
  const send = {
    sendText: jest.fn().mockResolvedValue({ id: 'KT_TEST_REPLY' }),
  };
  const engine = new BotCommandEngineService(
    new BotCommandParserService(),
    commands as any,
    plugins as any,
    new BotReplyTemplateService(),
    send as any,
    new ToolsService(),
  );
  return {
    bridge,
    commands,
    descriptor,
    engine,
    mappings,
    plugins,
    repository,
    send,
  };
};

describe('NATMap command HTTP and official permission boundaries', () => {
  it('executes the original full command through a real local HTTP listener', async () => {
    const harness = createHarness();
    const module = await Test.createTestingModule({
      controllers: [BotCommandController],
      providers: [
        { provide: BotCommandEngineService, useValue: harness.engine },
        { provide: BotCommandService, useValue: harness.commands },
        { provide: ToolsService, useValue: new ToolsService() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      for (const [selector, status, protocol] of [
        ['WireGuard Hub NATMap', 'current', 'UDP'],
        ['NAS TLS Gateway', 'current', 'TCP'],
        ['Missing Channel', 'not-found', ''],
        ['UDP Keeper', 'not-found', ''],
        ['Unsupported UDP', 'not-found', ''],
        ['Deleted TCP', 'not-found', ''],
        ['Disabled TCP', 'not-found', ''],
        ['', 'ambiguous', ''],
      ]) {
        const response = await fetch(`${base}/bot/command/test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commandId: command.id,
            text: `/natmap ${selector}`.trim(),
          }),
          signal: AbortSignal.timeout(5000),
        });
        expect(response.status).toBe(200);
        const result = (await response.json()).data;
        expect(result).toMatchObject({
          matched: true,
          output: { status },
        });
        if (selector)
          expect(result.input).toMatchObject({ raw: selector, text: selector });
        if (protocol) expect(result.replyText).toContain(`协议：${protocol}`);
        if (selector === 'WireGuard Hub NATMap') {
          expect(result.output).toMatchObject({
            channel: selector,
            publicPort: 55505,
          });
          expect(result.input.args).toEqual(['WireGuard', 'Hub', 'NATMap']);
        }
        expect(JSON.stringify(result.output)).not.toMatch(
          /203\.0\.113|192\.168|targetIpv4|internalPort/,
        );
      }
      expect(harness.repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 17,
          select: expect.arrayContaining(['protocol']),
          where: expect.arrayContaining([
            expect.objectContaining({
              protocol: 'udp',
              externalPort: 51825,
              internalPort: 51820,
              natmapDesiredEnabled: true,
            }),
          ]),
        }),
      );
      expect(harness.send.sendText).not.toHaveBeenCalled();
      harness.mappings[0].currentValidUntil = new Date('2000-01-01T00:00:00Z');
      const stale = await harness.engine.preview({
        commandId: command.id,
        text: '/natmap WireGuard Hub NATMap',
      });
      expect(stale).toMatchObject({
        output: { status: 'stale', publicPort: null },
      });
      harness.descriptor.manifest.permissions = [];
      const denied = await harness.engine.preview({
        commandId: command.id,
        text: '/natmap WireGuard Hub NATMap',
      });
      expect(denied).toMatchObject({
        output: { status: 'unavailable', publicPort: null },
      });
    } finally {
      await app.close();
    }
  });

  it('stops official messages before command execution when the allowlist has no match, then preserves reply context for an allowed event', async () => {
    const harness = createHarness();
    const parameters: Record<string, unknown> = {};
    const builder = {
      where: jest.fn((_condition, values) => {
        Object.assign(parameters, values);
        return builder;
      }),
      andWhere: jest.fn((_condition, values) => {
        Object.assign(parameters, values);
        return builder;
      }),
      getCount: jest.fn().mockResolvedValue(0),
    };
    const permissions = new BotPermissionService(
      {
        getPermissionConfig: async () => ({
          allowlistEnabled: true,
          blocklistEnabled: false,
        }),
      } as any,
      { createQueryBuilder: () => builder } as any,
      {} as any,
      new ToolsService(),
    );
    const rules = new BotRuleEngineService(
      {} as any,
      harness.engine,
      permissions,
      harness.plugins as any,
      {} as any,
      harness.send as any,
      new ToolsService(),
    );
    const message = {
      messageId: 'KT_TEST_INBOUND',
      messageText: '/natmap WireGuard Hub NATMap',
      messageType: 'group',
      selfId: 'qq-official:1020000000',
      targetId: 'KT_TEST_GROUP_OPENID',
      userId: 'KT_TEST_MEMBER_OPENID',
      rawEvent: {},
      replyMessageId: 'KT_TEST_INBOUND',
      adapterReplyContext: {
        msgId: 'KT_TEST_INBOUND',
        scope: 'group',
        targetId: 'KT_TEST_GROUP_OPENID',
      },
    };
    await rules.handleMessage(message as any, { pluginKeys: ['natmap-port'] });
    expect(parameters.selfId).toBe(message.selfId);
    expect(harness.commands.listEnabledForMessage).not.toHaveBeenCalled();
    expect(harness.send.sendText).not.toHaveBeenCalled();
    builder.getCount.mockResolvedValue(1);
    await rules.handleMessage(message as any, { pluginKeys: ['natmap-port'] });
    expect(harness.commands.listEnabledForMessage).toHaveBeenCalledWith(
      message,
      { pluginKeys: ['natmap-port'] },
    );
    expect(harness.send.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        selfId: message.selfId,
        targetId: message.targetId,
        replyMessageId: message.replyMessageId,
        adapterReplyContext: message.adapterReplyContext,
        message: expect.stringContaining('协议：UDP'),
      }),
    );
  });
});
