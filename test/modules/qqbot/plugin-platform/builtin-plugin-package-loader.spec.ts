import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QqbotBuiltinPluginPackageLoaderService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service';

describe('QqbotBuiltinPluginPackageLoaderService', () => {
  const createLoader = () =>
    new QqbotBuiltinPluginPackageLoaderService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    ) as any;

  it('resolves built-in plugin manifests from compiled qqbot plugin package root', () => {
    const originalCwd = process.cwd();
    const sandbox = mkdtempSync(join(tmpdir(), 'kt-plugin-loader-'));

    try {
      process.chdir(sandbox);

      const pluginRoot = createLoader().resolvePluginRoot('bangdream') as string;
      const normalized = pluginRoot.replace(/\\/g, '/');

      expect(normalized).toMatch(/modules\/qqbot\/plugins\/bangdream$/);
      expect(normalized).not.toContain('/plugin-platform/plugins/');
    } finally {
      process.chdir(originalCwd);
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
