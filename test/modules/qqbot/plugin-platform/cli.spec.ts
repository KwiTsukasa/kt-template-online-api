import * as fs from 'fs';
import * as path from 'path';
import { runQqbotPluginCli } from '../../../../scripts/qqbot-plugin/cli';
import { parseQqbotPluginManifest } from '../../../../src/modules/qqbot/plugin-platform/manifest';

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
});
