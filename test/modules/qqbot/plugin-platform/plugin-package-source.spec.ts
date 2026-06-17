import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { QqbotPluginPackagePathPolicyService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service';
import { QqbotPluginPackageSourceService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service';

describe('QqbotPluginPackageSourceService', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'qqbot-plugin-source-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('discovers packages from plugin.json without importing package code', async () => {
    const packageRoot = join(tempRoot, 'sample');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'plugin.json'),
      JSON.stringify({
        key: 'sample',
        name: 'Sample',
        version: '1.0.0',
        entry: 'src/index.ts',
        runtime: {
          workerType: 'thread',
          timeoutMs: 5000,
          memoryMb: 128,
          maxConcurrency: 1,
          configKeys: ['SAMPLE_TOKEN'],
        },
        operations: [],
      }),
      'utf8',
    );
    writeFileSync(
      join(packageRoot, 'src', 'index.ts'),
      'throw new Error("entry must not be imported during discovery");',
      'utf8',
    );

    const source = new QqbotPluginPackageSourceService(
      new QqbotPluginPackagePathPolicyService([tempRoot]),
    );

    await expect(source.discoverPackages()).resolves.toEqual([
      expect.objectContaining({
        entry: 'src/index.ts',
        entryFile: join(packageRoot, 'src', 'index.ts'),
        manifest: expect.objectContaining({ key: 'sample' }),
        packageRoot,
        pluginKey: 'sample',
      }),
    ]);
  });

  it('rejects package entries that escape controlled roots', async () => {
    const packageRoot = join(tempRoot, 'escape');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, 'plugin.json'),
      JSON.stringify({
        key: 'escape',
        name: 'Escape',
        version: '1.0.0',
        entry: `..${sep}outside.ts`,
        runtime: {
          workerType: 'thread',
          timeoutMs: 5000,
          memoryMb: 128,
          maxConcurrency: 1,
        },
        operations: [],
      }),
      'utf8',
    );

    const source = new QqbotPluginPackageSourceService(
      new QqbotPluginPackagePathPolicyService([tempRoot]),
    );

    await expect(source.discoverPackages()).rejects.toThrow(
      'Plugin entry must stay inside the package root',
    );
  });
});
