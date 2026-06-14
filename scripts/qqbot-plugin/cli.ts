import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '../../src/modules/qqbot/plugin-platform/manifest';

export type QqbotPluginCliCommand =
  | 'create'
  | 'install-local'
  | 'pack'
  | 'validate';

export type QqbotPluginCliOptions = {
  cwd?: string;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
};

export type QqbotPluginCliResult = {
  command: QqbotPluginCliCommand;
  exitCode: number;
  packageHash?: string;
  packagePath?: string;
  pluginKey?: string;
  pluginRoot?: string;
  version?: string;
};

type PackedPluginFile = {
  path: string;
  sha256: string;
};

type PackedPlugin = {
  contentHash: string;
  files: PackedPluginFile[];
  manifest: QqbotPluginManifest;
};

const templateRoot = path.join(__dirname, 'templates', 'basic');
const packageExtension = '.qqbot-plugin.json';

const sha256 = (content: Buffer | string) =>
  crypto.createHash('sha256').update(content).digest('hex');

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const formatPluginName = (pluginKey: string) => {
  return pluginKey
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const readManifest = (pluginRoot: string) => {
  const manifestPath = path.join(pluginRoot, 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;

  return parseQqbotPluginManifest(manifest, { pluginRoot });
};

const copyTemplateFile = (
  sourcePath: string,
  targetPath: string,
  replacements: Record<string, string>,
) => {
  const content = fs.readFileSync(sourcePath);
  const textContent = content.toString('utf8');
  const rendered = Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(key, value),
    textContent,
  );

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, rendered);
};

const copyTemplateDirectory = (
  sourceRoot: string,
  targetRoot: string,
  replacements: Record<string, string>,
) => {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      copyTemplateDirectory(sourcePath, targetPath, replacements);
      continue;
    }

    copyTemplateFile(sourcePath, targetPath, replacements);
  }
};

const listPackageFiles = (pluginRoot: string): PackedPluginFile[] => {
  const files: PackedPluginFile[] = [];
  const ignoredRoots = new Set(['dist', 'node_modules']);

  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (current === pluginRoot && ignoredRoots.has(entry.name)) continue;

      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const relativePath = path
        .relative(pluginRoot, absolutePath)
        .replace(/\\/g, '/');
      files.push({
        path: relativePath,
        sha256: sha256(fs.readFileSync(absolutePath)),
      });
    }
  };

  visit(pluginRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
};

const buildPackedPlugin = (pluginRoot: string): PackedPlugin => {
  const manifest = readManifest(pluginRoot);
  const files = listPackageFiles(pluginRoot);
  const contentHash = sha256(
    stableStringify({
      files,
      manifest,
    }),
  );

  return {
    contentHash,
    files,
    manifest,
  };
};

const assertPackageIntegrity = (packedPlugin: PackedPlugin) => {
  const expectedHash = sha256(
    stableStringify({
      files: packedPlugin.files,
      manifest: packedPlugin.manifest,
    }),
  );

  if (packedPlugin.contentHash !== expectedHash) {
    throw new Error('QQBot plugin package content hash mismatch.');
  }

  parseQqbotPluginManifest(packedPlugin.manifest);
};

const createPlugin = (
  pluginKey: string | undefined,
  options: Required<QqbotPluginCliOptions>,
): QqbotPluginCliResult => {
  if (!pluginKey) throw new Error('Usage: qqbot-plugin create <pluginKey>');

  const pluginRoot = path.join(options.cwd, 'plugins', pluginKey);
  if (fs.existsSync(pluginRoot)) {
    throw new Error(`Plugin already exists: ${pluginRoot}`);
  }

  copyTemplateDirectory(templateRoot, pluginRoot, {
    __PLUGIN_KEY__: pluginKey,
    __PLUGIN_NAME__: formatPluginName(pluginKey),
  });
  fs.mkdirSync(path.join(pluginRoot, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'tests'), { recursive: true });
  readManifest(pluginRoot);

  options.stdout(`Created QQBot plugin: ${pluginRoot}`);
  return {
    command: 'create',
    exitCode: 0,
    pluginKey,
    pluginRoot,
    version: '0.1.0',
  };
};

const validatePlugin = (
  pluginRootArg: string | undefined,
  options: Required<QqbotPluginCliOptions>,
): QqbotPluginCliResult => {
  if (!pluginRootArg) throw new Error('Usage: qqbot-plugin validate <path>');

  const pluginRoot = path.resolve(options.cwd, pluginRootArg);
  const manifest = readManifest(pluginRoot);
  options.stdout(
    `Validated QQBot plugin: ${manifest.pluginKey}@${manifest.version}`,
  );

  return {
    command: 'validate',
    exitCode: 0,
    pluginKey: manifest.pluginKey,
    pluginRoot,
    version: manifest.version,
  };
};

const packPlugin = (
  pluginRootArg: string | undefined,
  options: Required<QqbotPluginCliOptions>,
): QqbotPluginCliResult => {
  if (!pluginRootArg) throw new Error('Usage: qqbot-plugin pack <path>');

  const pluginRoot = path.resolve(options.cwd, pluginRootArg);
  const packedPlugin = buildPackedPlugin(pluginRoot);
  const shortHash = packedPlugin.contentHash.slice(0, 12);
  const packagePath = path.join(
    pluginRoot,
    'dist',
    `${packedPlugin.manifest.pluginKey}-${packedPlugin.manifest.version}-${shortHash}${packageExtension}`,
  );

  fs.mkdirSync(path.dirname(packagePath), { recursive: true });
  fs.writeFileSync(packagePath, `${JSON.stringify(packedPlugin, null, 2)}\n`);
  options.stdout(`Packed QQBot plugin: ${packagePath}`);

  return {
    command: 'pack',
    exitCode: 0,
    packageHash: packedPlugin.contentHash,
    packagePath,
    pluginKey: packedPlugin.manifest.pluginKey,
    pluginRoot,
    version: packedPlugin.manifest.version,
  };
};

const installLocalPlugin = (
  packagePathArg: string | undefined,
  options: Required<QqbotPluginCliOptions>,
): QqbotPluginCliResult => {
  if (!packagePathArg) {
    throw new Error('Usage: qqbot-plugin install-local <package>');
  }

  const packagePath = path.resolve(options.cwd, packagePathArg);
  const packedPlugin = JSON.parse(
    fs.readFileSync(packagePath, 'utf8'),
  ) as PackedPlugin;
  assertPackageIntegrity(packedPlugin);
  options.stdout(
    `Installed local QQBot plugin package: ${packedPlugin.manifest.pluginKey}@${packedPlugin.manifest.version}`,
  );

  return {
    command: 'install-local',
    exitCode: 0,
    packageHash: packedPlugin.contentHash,
    packagePath,
    pluginKey: packedPlugin.manifest.pluginKey,
    version: packedPlugin.manifest.version,
  };
};

export const runQqbotPluginCli = async (
  argv: string[],
  options: QqbotPluginCliOptions = {},
): Promise<QqbotPluginCliResult> => {
  const command = argv[0] as QqbotPluginCliCommand | undefined;
  const resolvedOptions: Required<QqbotPluginCliOptions> = {
    cwd: options.cwd || process.cwd(),
    stderr: options.stderr || ((message) => console.error(message)),
    stdout: options.stdout || ((message) => console.log(message)),
  };

  switch (command) {
    case 'create':
      return createPlugin(argv[1], resolvedOptions);
    case 'install-local':
      return installLocalPlugin(argv[1], resolvedOptions);
    case 'pack':
      return packPlugin(argv[1], resolvedOptions);
    case 'validate':
      return validatePlugin(argv[1], resolvedOptions);
    default:
      throw new Error(
        'Usage: qqbot-plugin <create|validate|pack|install-local> [args]',
      );
  }
};

if (require.main === module) {
  runQqbotPluginCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
