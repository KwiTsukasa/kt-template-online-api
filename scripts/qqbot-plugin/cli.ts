import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '../../src/modules/qqbot/plugin-platform/domain/manifest';

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
  installationId?: string;
  packageHash?: string;
  packagePath?: string;
  pluginKey?: string;
  pluginRoot?: string;
  version?: string;
  versionId?: string;
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
const maxPackageFileBytes = 5 * 1024 * 1024;
const pluginKeyPattern = /^[a-z][a-z0-9-]{2,63}$/;
const allowedTopLevelEntries = new Set([
  'LICENSE',
  'LICENSE.txt',
  'README.md',
  'assets',
  'migrations',
  'plugin.json',
  'src',
  'tests',
]);

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

const getOptionValue = (argv: string[], optionName: string) => {
  const optionIndex = argv.indexOf(optionName);
  if (optionIndex < 0) return undefined;

  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Usage: ${optionName} <path>`);
  }
  return value;
};

const isInsideDirectory = (parent: string, child: string) => {
  const relativePath = path.relative(parent, child);
  return (
    relativePath === '' ||
    (!!relativePath &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath))
  );
};

const findWorkspaceRoot = (cwd: string) => {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, 'AGENTS.md'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const getControlledRoots = (options: Required<QqbotPluginCliOptions>) => {
  const cwd = path.resolve(options.cwd);
  const roots = [cwd];

  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    const workspaceRoot = findWorkspaceRoot(cwd);
    if (workspaceRoot) roots.push(path.join(workspaceRoot, '.kt-workspace'));
  }

  return roots;
};

const resolveControlledPath = (
  pathArg: string,
  options: Required<QqbotPluginCliOptions>,
  label: string,
) => {
  const resolvedPath = path.resolve(options.cwd, pathArg);
  const allowed = getControlledRoots(options).some((root) =>
    isInsideDirectory(root, resolvedPath),
  );
  if (!allowed) {
    throw new Error(`Unsafe ${label} output path: ${resolvedPath}`);
  }
  return resolvedPath;
};

function assertPluginKey(
  pluginKey: string | undefined,
): asserts pluginKey is string {
  if (!pluginKey) throw new Error('Usage: qqbot-plugin create <pluginKey>');
  if (!pluginKeyPattern.test(pluginKey)) {
    throw new Error(`Invalid QQBot plugin key: ${pluginKey}`);
  }
}

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
      if (entry.name.startsWith('.')) {
        throw new Error(`Hidden files are not allowed in plugin packages: ${entry.name}`);
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in plugin packages: ${entry.name}`);
      }

      const absolutePath = path.join(current, entry.name);
      const relativePath = path
        .relative(pluginRoot, absolutePath)
        .replace(/\\/g, '/');
      const topLevelEntry = relativePath.split('/')[0];
      if (!allowedTopLevelEntries.has(topLevelEntry)) {
        throw new Error(`Plugin package path is not whitelisted: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const fileSize = fs.statSync(absolutePath).size;
      if (fileSize > maxPackageFileBytes) {
        throw new Error(`Plugin package file is too large: ${relativePath}`);
      }

      files.push({
        path: relativePath,
        sha256: sha256(fs.readFileSync(absolutePath)),
      });
    }
  };

  visit(pluginRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
};

const assertPluginSourceBoundary = (pluginRoot: string) => {
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/\bfrom\s+['"]@nestjs\//, '@nestjs imports'],
    [/\bfrom\s+['"](?:node:)?fs['"]/, 'fs imports'],
    [/\brequire\(['"](?:node:)?fs['"]\)/, 'fs require'],
    [/\bfrom\s+['"]axios['"]/, 'axios imports'],
    [/\brequire\(['"]axios['"]\)/, 'axios require'],
    [/\bprocess\.env\b/, 'process.env access'],
  ];

  for (const file of listPackageFiles(pluginRoot)) {
    if (!/\.[cm]?[tj]sx?$/.test(file.path)) continue;
    const filePath = path.join(pluginRoot, file.path);
    const source = fs.readFileSync(filePath, 'utf8');
    const violation = forbiddenPatterns.find(([pattern]) => pattern.test(source));
    if (violation) {
      throw new Error(
        `Forbidden plugin source boundary violation in ${file.path}: ${violation[1]}`,
      );
    }
  }
};

const buildPackedPlugin = (pluginRoot: string): PackedPlugin => {
  const manifest = readManifest(pluginRoot);
  assertPluginSourceBoundary(pluginRoot);
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
  outputPathArg?: string,
): QqbotPluginCliResult => {
  assertPluginKey(pluginKey);

  const pluginRoot = outputPathArg
    ? resolveControlledPath(outputPathArg, options, 'create')
    : path.join(options.cwd, 'plugins', pluginKey);
  if (fs.existsSync(pluginRoot)) {
    throw new Error(`Plugin already exists: ${pluginRoot}`);
  }

  copyTemplateDirectory(templateRoot, pluginRoot, {
    __PLUGIN_KEY__: pluginKey,
    __PLUGIN_NAME__: formatPluginName(pluginKey),
  });
  fs.mkdirSync(path.join(pluginRoot, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'src', 'application'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(pluginRoot, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'src', 'events'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'src', 'infrastructure'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(pluginRoot, 'src', 'operations'), { recursive: true });
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
  assertPluginSourceBoundary(pluginRoot);
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
  outputPathArg?: string,
): QqbotPluginCliResult => {
  if (!pluginRootArg) throw new Error('Usage: qqbot-plugin pack <path>');

  const pluginRoot = path.resolve(options.cwd, pluginRootArg);
  const packedPlugin = buildPackedPlugin(pluginRoot);
  const shortHash = packedPlugin.contentHash.slice(0, 12);
  const packageRoot = outputPathArg
    ? resolveControlledPath(outputPathArg, options, 'pack')
    : path.join(pluginRoot, 'dist');
  const packagePath = path.join(
    packageRoot,
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
  const versionId = sha256(
    `version:${packedPlugin.manifest.pluginKey}:${packedPlugin.manifest.version}:${packedPlugin.contentHash}`,
  ).slice(0, 16);
  const installationId = sha256(
    `installation:${packagePath}:${packedPlugin.contentHash}`,
  ).slice(0, 16);
  options.stdout(
    `Installed local QQBot plugin package: ${packedPlugin.manifest.pluginKey}@${packedPlugin.manifest.version}`,
  );

  return {
    command: 'install-local',
    exitCode: 0,
    installationId,
    packageHash: packedPlugin.contentHash,
    packagePath,
    pluginKey: packedPlugin.manifest.pluginKey,
    version: packedPlugin.manifest.version,
    versionId,
  };
};

export const runQqbotPluginCli = async (
  argv: string[],
  options: QqbotPluginCliOptions = {},
): Promise<QqbotPluginCliResult> => {
  const command = argv[0] as QqbotPluginCliCommand | undefined;
  const resolvedOptions: Required<QqbotPluginCliOptions> = {
    cwd: options.cwd || process.cwd(),
    stderr: options.stderr || ((message) => process.stderr.write(`${message}\n`)),
    stdout: options.stdout || ((message) => process.stdout.write(`${message}\n`)),
  };

  switch (command) {
    case 'create':
      return createPlugin(argv[1], resolvedOptions, getOptionValue(argv, '--out'));
    case 'install-local':
      return installLocalPlugin(argv[1], resolvedOptions);
    case 'pack':
      return packPlugin(argv[1], resolvedOptions, getOptionValue(argv, '--out'));
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
