import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../..');

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('Bot Adapter core plugin execution ports', () => {
  it('defines core-side plugin execution and event dispatch ports', () => {
    const portPath = join(
      repoRoot,
      'src/modules/bot-adapter/core/domain/plugin-execution.port.ts',
    );

    expect(existsSync(portPath)).toBe(true);
    if (!existsSync(portPath)) return;

    const source = readFileSync(portPath, 'utf8');
    const protocol = readSource(
      'src/modules/plugin-platform/contract/plugin-protocol/plugin-protocol.ts',
    );
    expect(source).toContain('BOT_PLUGIN_PROTOCOL');
    expect(source).toContain('BotPluginProtocol');
    expect(protocol).toContain('executeOperation');
    expect(protocol).toContain('dispatchEvent');
    expect(protocol).toContain('listActiveOperations');
    expect(protocol).toContain('getOperationByCommand');
    expect(source).not.toContain('bindAccountPlugin');
    expect(source).not.toContain('listBoundPluginKeys');
    expect(source).not.toContain('unbindAccountPlugin');
  });

  it('keeps command parser generic and leaves plugin-specific parsing to plugins', () => {
    const source = readSource(
      'src/modules/bot-adapter/core/application/command/bot-command-parser.service.ts',
    );

    const bannedParserSignals = [
      'DictService',
      'ff14Price',
      'fflogsCharacter',
      '@/modules/plugins/',
    ].filter((signal) => source.includes(signal));

    expect(bannedParserSignals).toEqual([]);
    expect(source).toContain('rawArgs');
  });

  it('dispatches unconsumed events through Plugin Platform instead of directly invoking Repeater', () => {
    const source = readSource(
      'src/modules/bot-adapter/core/application/send/bot-rule-engine.service.ts',
    );

    const bannedRepeaterSignals = [
      `Bot${'RepeaterPluginService'}`,
      '@/modules/plugins/repeater',
    ].filter((signal) => source.includes(signal));
    const missingDispatcherSignals = ['dispatchEvent'].filter(
      (signal) => !source.includes(signal),
    );

    expect(bannedRepeaterSignals).toEqual([]);
    expect(missingDispatcherSignals).toEqual([]);
  });
});
