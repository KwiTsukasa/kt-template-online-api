import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import * as ts from 'typescript';
import { parsePluginManifest } from '@/modules/plugin-platform/domain/manifest';
import { PluginPlatformService } from '@/modules/plugin-platform/application/plugin-platform.service';
import { BotRuleEngineService } from '@/modules/bot-adapter/core/application/send/bot-rule-engine.service';
import { ToolsService } from '@/common';

const root = resolve(__dirname, '../../..');
const manifest = JSON.parse(
  readFileSync(
    resolve(root, 'src/modules/plugins/hermes-agent/plugin.json'),
    'utf8',
  ),
);

describe('持久对话能力与插件边界', () => {
  it('accepts a renamed plugin and rejects unknown conversation modes', () => {
    const renamed = { ...manifest, pluginKey: 'independent-assistant' };
    const parsed = parsePluginManifest(renamed);
    expect(parsed.events[0].conversationMode).toBe('persistent');
    const platform = Object.create(PluginPlatformService.prototype) as any;
    platform.activeWorkerContexts = new Map([
      ['test', { pluginKey: renamed.pluginKey, manifest: parsed }],
    ]);
    expect(platform.listConversationPlugins()).toEqual([
      'independent-assistant',
    ]);
    expect(() =>
      parsePluginManifest({
        ...renamed,
        events: [{ ...renamed.events[0], conversationMode: 'unknown' }],
      }),
    ).toThrow();
    platform.activeWorkerContexts.clear();
    expect(platform.listConversationPlugins()).toEqual([]);
  });

  it('routes a declared conversation plugin through generic tasks while preserving inline event plugins', async () => {
    const dispatchEvent = jest
      .fn()
      .mockResolvedValue({ handled: true, replies: [] });
    const tasks = { wakePending: jest.fn(), enqueue: jest.fn() };
    const engine = new BotRuleEngineService(
      {} as any,
      { handleMessage: async () => false } as any,
      { isBlocked: async () => false, isAllowed: async () => true } as any,
      {
        dispatchEvent,
        listConversationPlugins: () => ['independent-assistant'],
      } as any,
      { listEnabledForMessage: async () => [] } as any,
      {} as any,
      new ToolsService(),
      undefined,
      undefined,
      undefined,
      tasks as any,
    );
    await engine.handleMessage(
      {
        selfId: 'account',
        userId: 'sender',
        targetId: 'sender',
        messageType: 'private',
        messageText: '查资料',
        rawEvent: {},
        messageId: 'event',
        eventTime: new Date(),
      } as any,
      { pluginKeys: ['independent-assistant', 'plain-event'] },
    );
    expect(tasks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'independent-assistant',
      undefined,
    );
    expect(dispatchEvent.mock.calls[0][0].pluginKeys).toEqual(['plain-event']);
  });

  it('keeps execution failure distinct from delivery and rejects conflicting continuation', () => {
    const platform = Object.create(PluginPlatformService.prototype) as any;
    expect(
      platform.normalizeEventResult({
        handled: true,
        failureCode: 'run_failed',
        replies: [],
      }),
    ).toMatchObject({ failureCode: 'run_failed' });
    expect(() =>
      platform.normalizeEventResult({
        handled: true,
        failureCode: 'run_failed',
        continuation: { state: { runId: 'r' }, delayMs: 2000 },
        replies: [],
      }),
    ).toThrow();
  });

  it('forbids imports of another plugin implementation across the four affected plugin packages', () => {
    const pluginsRoot = resolve(root, 'src/modules/plugins');
    const violations: string[] = [];
    const walk = (directory: string, owner: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          walk(file, owner);
          continue;
        }
        if (!/\.[cm]?[jt]s$/u.test(file)) continue;
        const ast = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        const visit = (node: ts.Node) => {
          let specifier: ts.Expression | undefined;
          if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            specifier = node.moduleSpecifier;
          if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              node.expression.getText(ast) === 'require')
          )
            specifier = node.arguments[0];
          if (specifier && ts.isStringLiteral(specifier)) {
            let target = '';
            if (specifier.text.startsWith('.'))
              target = resolve(dirname(file), specifier.text);
            if (specifier.text.startsWith('@/'))
              target = resolve(root, 'src', specifier.text.slice(2));
            if (target.startsWith(pluginsRoot)) {
              const targetOwner = relative(pluginsRoot, target).split(
                /[\\/]/u,
              )[0];
              if (targetOwner !== owner)
                violations.push(`${relative(root, file)} -> ${specifier.text}`);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(ast);
      }
    };
    for (const owner of [
      'hermes-agent',
      'persona-switch',
      'fflogs',
      'ff14-market',
    ])
      walk(resolve(pluginsRoot, owner, 'src'), owner);
    expect(violations).toEqual([]);
    const route = readFileSync(
      resolve(
        root,
        'src/modules/bot-adapter/core/application/send/bot-rule-engine.service.ts',
      ),
      'utf8',
    );
    expect(route).not.toContain("'hermes-agent'");
  });
});
