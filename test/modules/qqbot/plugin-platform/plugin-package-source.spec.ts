import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
        manifest: expect.objectContaining({
          key: 'sample',
          pluginKey: 'sample',
          runtime: expect.objectContaining({ workerType: 'thread' }),
        }),
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
      'PATH_OUTSIDE_PLUGIN_ROOT',
    );
  });

  it('resolves entry files from parser-normalized package paths', async () => {
    const packageRoot = join(tempRoot, 'windows-entry');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'plugin.json'),
      JSON.stringify({
        key: 'windows-entry',
        name: 'Windows Entry',
        version: '1.0.0',
        entry: 'src\\\\index.ts',
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

    const pathPolicy = new QqbotPluginPackagePathPolicyService([tempRoot]);
    const resolveEntryFileSpy = jest.spyOn(pathPolicy, 'resolveEntryFile');
    const source = new QqbotPluginPackageSourceService(pathPolicy);

    await expect(source.discoverPackages()).resolves.toEqual([
      expect.objectContaining({
        entry: 'src/index.ts',
        entryFile: join(packageRoot, 'src', 'index.ts'),
        pluginKey: 'windows-entry',
      }),
    ]);
    expect(resolveEntryFileSpy).toHaveBeenCalledWith(
      packageRoot,
      'src/index.ts',
    );
  });

  it('resolves TypeScript manifest entries to compiled JavaScript files in dist packages', async () => {
    const packageRoot = join(tempRoot, 'compiled-entry');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'plugin.json'),
      JSON.stringify({
        key: 'compiled-entry',
        name: 'Compiled Entry',
        version: '1.0.0',
        entry: 'src/index.ts',
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
    writeFileSync(
      join(packageRoot, 'src', 'index.js'),
      'module.exports = { createPlugin() {} };',
      'utf8',
    );

    const source = new QqbotPluginPackageSourceService(
      new QqbotPluginPackagePathPolicyService([tempRoot]),
    );

    await expect(source.discoverPackages()).resolves.toEqual([
      expect.objectContaining({
        entry: 'src/index.ts',
        entryFile: join(packageRoot, 'src', 'index.js'),
        pluginKey: 'compiled-entry',
      }),
    ]);
  });

  it('discovers the default built-in plugin root from production dist output', async () => {
    const previousCwd = process.cwd();
    const productionRoot = join(tempRoot, 'production-app');
    const distPluginRoot = join(
      productionRoot,
      'dist',
      'modules',
      'qqbot',
      'plugins',
    );
    mkdirSync(distPluginRoot, { recursive: true });

    try {
      process.chdir(productionRoot);
      jest.resetModules();
      const {
        QqbotPluginPackagePathPolicyService: RuntimePathPolicyService,
      } = await import(
        '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service'
      );
      const pathPolicy = new RuntimePathPolicyService();

      expect(pathPolicy.listExistingRoots()).toEqual([distPluginRoot]);
    } finally {
      process.chdir(previousCwd);
      jest.resetModules();
    }
  });

  it('does not keep platform-side manifest transfer shims', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-source.service.ts',
      ),
      'utf8',
    );

    expect(source).not.toMatch(
      /normalizeManifestForCurrentParser|attachPackageKeyAlias|readPackageKey/,
    );
    expect(source).not.toMatch(
      /thread[\s\S]{0,80}node-worker|node-worker[\s\S]{0,80}thread/,
    );
  });
});
