import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('QQBot plugin platform DI tokens', () => {
  it('does not inject the removed built-in plugin loader into platform services', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/modules/qqbot/plugin-platform/plugin-platform.module.ts',
      ),
      'utf8',
    );

    expect(source).not.toContain(
      `Qqbot${'Builtin'}PluginPackageLoaderService`,
    );
    expect(source).toContain('QqbotPluginPackageSourceService');
    expect(source).toContain('QqbotPluginWorkerRuntimeFactoryService');
  });
});
