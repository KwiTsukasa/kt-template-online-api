import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../..');

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('QQBot core plugin execution ports', () => {
  it('defines core-side plugin execution and event dispatch ports', () => {
    const portPath = join(
      repoRoot,
      'src/modules/qqbot/core/domain/plugin-execution.port.ts',
    );

    expect(existsSync(portPath)).toBe(true);
    if (!existsSync(portPath)) return;

    const source = readFileSync(portPath, 'utf8');
    expect(source).toEqual(expect.stringContaining('executeOperation'));
    expect(source).toEqual(expect.stringContaining('dispatchEvent'));
    expect(source).toEqual(expect.stringContaining('listActiveOperations'));
    expect(source).toEqual(expect.stringContaining('getOperationByCommand'));
  });

  it('keeps command parser generic and leaves plugin-specific parsing to plugins', () => {
    const source = readSource(
      'src/modules/qqbot/core/application/command/qqbot-command-parser.service.ts',
    );

    const bannedParserSignals = [
      'DictService',
      'ff14Price',
      'fflogsCharacter',
      '@/modules/qqbot/plugins/',
    ].filter((signal) => source.includes(signal));

    expect(bannedParserSignals).toEqual([]);
    expect(source).toContain('rawArgs');
  });

  it('dispatches unconsumed events through Plugin Platform instead of directly invoking Repeater', () => {
    const source = readSource(
      'src/modules/qqbot/core/application/rule/qqbot-rule-engine.service.ts',
    );

    const bannedRepeaterSignals = [
      'QqbotRepeaterPluginService',
      '@/modules/qqbot/plugins/repeater',
    ].filter((signal) => source.includes(signal));
    const missingDispatcherSignals = ['dispatchEvent'].filter(
      (signal) => !source.includes(signal),
    );

    expect(bannedRepeaterSignals).toEqual([]);
    expect(missingDispatcherSignals).toEqual([]);
  });
});
