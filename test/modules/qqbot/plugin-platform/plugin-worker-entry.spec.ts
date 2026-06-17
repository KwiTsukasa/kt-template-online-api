import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';
import { createPluginFromDescriptor } from '@/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread';

describe('generic plugin worker entry', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'qqbot-plugin-worker-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('loads a package entry from the descriptor instead of a plugin key switch', async () => {
    const packageRoot = join(tempRoot, 'sample');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    const entryFile = join(packageRoot, 'src', 'index.js');
    writeFileSync(
      entryFile,
      `
      exports.createPlugin = (options) => ({
        activate: async () => undefined,
        health: async () => ({
          configSnapshot: options.runtime.configSnapshot,
          installationId: options.runtime.installationId,
          ok: true,
          pluginKey: options.manifest.key,
        }),
        operations: [],
      });
      `,
      'utf8',
    );

    const plugin = await createPluginFromDescriptor({
      configSnapshot: { SAMPLE_TOKEN: 'local-token' },
      descriptor: {
        entry: 'src/index.js',
        entryFile,
        manifest: createManifest('sample', 'src/index.js'),
        packageRoot,
        pluginKey: 'sample',
      },
      host: {},
      installationId: 'install-1',
    });

    await expect(plugin.health?.()).resolves.toEqual({
      configSnapshot: { SAMPLE_TOKEN: 'local-token' },
      installationId: 'install-1',
      ok: true,
      pluginKey: 'sample',
    });
  });

  it('keeps the generic worker entry free of concrete plugin branches', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts',
      ),
      'utf8',
    );

    expect(source).toContain('node:worker_threads');
    expect(source).toContain('descriptor');
    expect(source).not.toMatch(
      new RegExp(
        [
          `create${'BangDream'}Plugin`,
          `create${'Ff14Market'}Plugin`,
          `create${'Fflogs'}Plugin`,
          `create${'Repeater'}Plugin`,
          String.raw`pluginKey\s*===`,
          String.raw`case\s+['"]`,
        ].join('|'),
      ),
    );
  });
});

/**
 * Builds a minimal parsed-manifest-shaped descriptor manifest for direct worker entry tests.
 * @param key - Plugin package key used by the temp descriptor and health assertion.
 * @param entry - Package-relative entry file that the descriptor resolves to the temp module.
 * @returns Manifest payload accepted by descriptor-based worker creation.
 */
function createManifest(key: string, entry: string): QqbotPluginManifest {
  return {
    assets: [],
    configSchema: {},
    entry,
    events: [],
    key,
    legacyAliases: [],
    migrations: [],
    minApiSdkVersion: '1.0.0',
    name: 'Sample',
    operations: [],
    permissions: [],
    pluginKey: key,
    runtime: {
      configKeys: ['SAMPLE_TOKEN'],
      maxConcurrency: 1,
      memoryMb: 128,
      timeoutMs: 5000,
      workerType: 'thread',
    },
    tasks: [],
    version: '1.0.0',
  };
}
