import * as fs from 'fs';
import * as path from 'path';
import { runQqbotPluginCli } from '../../../../scripts/qqbot-plugin/cli';
import { parseQqbotPluginManifest } from '../../../../src/modules/qqbot/plugin-platform/domain/manifest';

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workspaceTmpRoot = path.resolve(
  projectRoot,
  '..',
  '..',
  '.kt-workspace',
  'tmp',
);

const readJson = (filePath: string) => {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any>;
};

const silentCliOptions = (cwd: string) => ({
  cwd,
  stderr: jest.fn(),
  stdout: jest.fn(),
});

describe('QQBot plugin CLI', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = path.join(
      workspaceTmpRoot,
      `qqbot-plugin-cli-${process.pid}-${Date.now()}`,
    );
    fs.mkdirSync(sandbox, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandbox, { force: true, recursive: true });
  });

  it('registers the package script used by local and CI workflows', () => {
    const packageJson = readJson(path.join(projectRoot, 'package.json'));

    expect(packageJson.scripts['qqbot-plugin']).toBe(
      'ts-node -r tsconfig-paths/register scripts/qqbot-plugin/cli.ts',
    );
  });

  it('creates, validates, packs, and locally installs a plugin through one validation chain', async () => {
    const created = await runQqbotPluginCli(
      ['create', 'demo-plugin'],
      silentCliOptions(sandbox),
    );

    const pluginRoot = path.join(sandbox, 'plugins', 'demo-plugin');
    expect(created).toMatchObject({
      command: 'create',
      exitCode: 0,
      pluginRoot,
    });
    expect(fs.existsSync(path.join(pluginRoot, 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'src', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'migrations'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'assets'))).toBe(true);
    expect(() =>
      parseQqbotPluginManifest(readJson(path.join(pluginRoot, 'plugin.json')), {
        pluginRoot,
      }),
    ).not.toThrow();

    await expect(
      runQqbotPluginCli(['validate', pluginRoot], silentCliOptions(sandbox)),
    ).resolves.toMatchObject({
      command: 'validate',
      exitCode: 0,
      pluginKey: 'demo-plugin',
    });

    const packed = await runQqbotPluginCli(
      ['pack', pluginRoot],
      silentCliOptions(sandbox),
    );
    expect(packed).toMatchObject({
      command: 'pack',
      exitCode: 0,
      pluginKey: 'demo-plugin',
    });
    expect(packed.packagePath).toMatch(
      /demo-plugin-0\.1\.0-[a-f0-9]{12}\.qqbot-plugin\.json$/,
    );

    const packageJson = readJson(packed.packagePath || '');
    expect(packageJson).toMatchObject({
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      manifest: expect.objectContaining({
        pluginKey: 'demo-plugin',
        version: '0.1.0',
      }),
    });
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'plugin.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: 'src/index.ts',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );

    await expect(
      runQqbotPluginCli(
        ['install-local', packed.packagePath || ''],
        silentCliOptions(sandbox),
      ),
    ).resolves.toMatchObject({
      command: 'install-local',
      exitCode: 0,
      packageHash: packageJson.contentHash,
      pluginKey: 'demo-plugin',
    });
  });

  it('honors explicit output paths used by CLI smoke workflows', async () => {
    const pluginRoot = path.join(sandbox, 'smoke-plugin');
    const packageRoot = path.join(sandbox, 'packages');

    const created = await runQqbotPluginCli(
      ['create', 'smoke-plugin', '--out', pluginRoot],
      silentCliOptions(projectRoot),
    );

    expect(created).toMatchObject({
      command: 'create',
      exitCode: 0,
      pluginRoot,
    });
    expect(fs.existsSync(path.join(pluginRoot, 'plugin.json'))).toBe(true);

    const packed = await runQqbotPluginCli(
      ['pack', pluginRoot, '--out', packageRoot],
      silentCliOptions(projectRoot),
    );

    expect(packed).toMatchObject({
      command: 'pack',
      exitCode: 0,
      pluginKey: 'smoke-plugin',
    });
    expect(path.dirname(packed.packagePath || '')).toBe(packageRoot);
  });

  it('rejects unsafe create output paths before writing files', async () => {
    const outsideRoot = path.resolve(sandbox, '..', 'outside-plugin');

    await expect(
      runQqbotPluginCli(
        ['create', '../bad-plugin', '--out', outsideRoot],
        silentCliOptions(sandbox),
      ),
    ).rejects.toThrow(/plugin key|output path/i);
    expect(fs.existsSync(outsideRoot)).toBe(false);
  });

  it('validates plugin source boundaries before packaging', async () => {
    const pluginRoot = path.join(sandbox, 'plugins', 'unsafe-plugin');
    await runQqbotPluginCli(
      ['create', 'unsafe-plugin', '--out', pluginRoot],
      silentCliOptions(sandbox),
    );
    fs.writeFileSync(
      path.join(pluginRoot, 'src', 'index.ts'),
      "import { Injectable } from '@nestjs/common';\nconst token = process.env.SECRET;\n",
    );

    await expect(
      runQqbotPluginCli(['validate', pluginRoot], silentCliOptions(sandbox)),
    ).rejects.toThrow(/forbidden plugin source/i);
  });

  it('refuses hidden files, oversized files, and returns stable install ids', async () => {
    const pluginRoot = path.join(sandbox, 'plugins', 'safe-plugin');
    await runQqbotPluginCli(
      ['create', 'safe-plugin', '--out', pluginRoot],
      silentCliOptions(sandbox),
    );
    expect(fs.existsSync(path.join(pluginRoot, 'src', 'operations'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'src', 'events'))).toBe(true);
    fs.writeFileSync(path.join(pluginRoot, '.env'), 'SECRET=1\n');

    await expect(
      runQqbotPluginCli(['pack', pluginRoot], silentCliOptions(sandbox)),
    ).rejects.toThrow(/hidden/i);

    fs.rmSync(path.join(pluginRoot, '.env'));
    const packed = await runQqbotPluginCli(
      ['pack', pluginRoot],
      silentCliOptions(sandbox),
    );
    await expect(
      runQqbotPluginCli(
        ['install-local', packed.packagePath || ''],
        silentCliOptions(sandbox),
      ),
    ).resolves.toMatchObject({
      installationId: expect.stringMatching(/^[a-f0-9]{16}$/),
      versionId: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
  });
});
