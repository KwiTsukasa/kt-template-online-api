import * as path from 'path';
import { normalizeQqbotPluginTaskCron } from '../../application/task';
import {
  QQBOT_PLUGIN_ALLOWED_PERMISSIONS,
  QQBOT_PLUGIN_WORKER_TYPES,
  type QqbotPluginAssetManifest,
  type QqbotPluginEventManifest,
  type QqbotPluginManifest,
  type QqbotPluginManifestParseOptions,
  type QqbotPluginManifestValidationIssue,
  type QqbotPluginMigrationManifest,
  type QqbotPluginOperationManifest,
  type QqbotPluginPermission,
  type QqbotPluginRuntimeManifest,
  type QqbotPluginTaskManifest,
  type QqbotPluginWorkerType,
} from './manifest.types';

const pluginKeyPattern = /^[a-z][a-z0-9-]{2,63}$/;
const legacyAliasPattern = /^[A-Za-z][A-Za-z0-9-]{2,63}$/;
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const capabilityKeyPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const windowsAbsolutePathPattern = /^[a-zA-Z]:[\\/]/;

const allowedPermissionSet = new Set<string>(QQBOT_PLUGIN_ALLOWED_PERMISSIONS);
const allowedWorkerTypeSet = new Set<string>(QQBOT_PLUGIN_WORKER_TYPES);

export class QqbotPluginManifestValidationError extends Error {
  constructor(readonly issues: QqbotPluginManifestValidationIssue[]) {
    super(
      `QQBot plugin manifest validation failed: ${issues
        .map((issue) => `${issue.path}:${issue.code}`)
        .join(', ')}`,
    );
    this.name = 'QqbotPluginManifestValidationError';
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const getString = (
  source: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getStringArray = (
  source: Record<string, unknown>,
  key: string,
): string[] => {
  const value = source[key];
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const getNumber = (
  source: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const pushIssue = (
  issues: QqbotPluginManifestValidationIssue[],
  code: string,
  pathName: string,
  message: string,
) => {
  issues.push({ code, message, path: pathName });
};

const normalizePackagePath = (
  value: unknown,
  pathName: string,
  issues: QqbotPluginManifestValidationIssue[],
): string => {
  if (typeof value !== 'string' || !value.trim()) {
    pushIssue(issues, 'REQUIRED_PATH', pathName, 'Package path is required.');
    return '';
  }

  const candidate = value.trim().replace(/\\/g, '/');
  const normalized = path.posix.normalize(candidate);
  const outsideRoot =
    candidate.includes('\0') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    path.posix.isAbsolute(candidate) ||
    windowsAbsolutePathPattern.test(candidate) ||
    normalized.split('/').includes('..');

  if (outsideRoot) {
    pushIssue(
      issues,
      'PATH_OUTSIDE_PLUGIN_ROOT',
      pathName,
      'Package paths must stay inside the plugin root.',
    );
    return candidate;
  }

  return normalized;
};

const normalizePermissions = (
  value: unknown,
  pathName: string,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginPermission[] => {
  if (!Array.isArray(value)) return [];

  const result: QqbotPluginPermission[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      pushIssue(
        issues,
        'INVALID_PERMISSION',
        `${pathName}[${index}]`,
        'Permission must be a non-empty string.',
      );
      return;
    }

    const permission = item.trim();
    if (!allowedPermissionSet.has(permission)) {
      pushIssue(
        issues,
        'UNKNOWN_PERMISSION',
        `${pathName}[${index}]`,
        `Unknown permission: ${permission}.`,
      );
      return;
    }

    if (!result.includes(permission as QqbotPluginPermission)) {
      result.push(permission as QqbotPluginPermission);
    }
  });

  return result;
};

const requireSemver = (
  value: string | undefined,
  pathName: string,
  issues: QqbotPluginManifestValidationIssue[],
) => {
  if (!value || !semanticVersionPattern.test(value)) {
    pushIssue(
      issues,
      'INVALID_SEMVER',
      pathName,
      'Version must use semantic version format.',
    );
  }
};

const requireKey = (
  value: string | undefined,
  pathName: string,
  issues: QqbotPluginManifestValidationIssue[],
) => {
  if (!value || !capabilityKeyPattern.test(value)) {
    pushIssue(
      issues,
      'INVALID_CAPABILITY_KEY',
      pathName,
      'Capability key must be dot-separated lower-case segments.',
    );
  }
};

const parseRuntime = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginRuntimeManifest => {
  const runtime = isPlainObject(source.runtime) ? source.runtime : {};
  const timeoutMs = getNumber(runtime, 'timeoutMs');
  const memoryMb = getNumber(runtime, 'memoryMb');
  const maxConcurrency = getNumber(runtime, 'maxConcurrency');
  const workerType = getString(runtime, 'workerType');

  if (!timeoutMs || !memoryMb || !maxConcurrency) {
    pushIssue(
      issues,
      'MISSING_RUNTIME_BUDGET',
      'runtime',
      'Runtime must declare timeoutMs, memoryMb, and maxConcurrency.',
    );
  }
  if (!workerType || !allowedWorkerTypeSet.has(workerType)) {
    pushIssue(
      issues,
      'INVALID_WORKER_TYPE',
      'runtime.workerType',
      'Runtime workerType is not supported.',
    );
  }

  return {
    maxConcurrency: maxConcurrency || 1,
    memoryMb: memoryMb || 128,
    timeoutMs: timeoutMs || 1000,
    workerType: (workerType || 'node-worker') as QqbotPluginWorkerType,
  };
};

const parseOperations = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginOperationManifest[] => {
  const operations = Array.isArray(source.operations) ? source.operations : [];
  const seenKeys = new Set<string>();

  return operations.filter(isPlainObject).map((operation, index) => {
    const pathPrefix = `operations[${index}]`;
    const key = getString(operation, 'key') || '';
    const timeoutMs = getNumber(operation, 'timeoutMs');

    requireKey(key, `${pathPrefix}.key`, issues);
    if (seenKeys.has(key)) {
      pushIssue(
        issues,
        'DUPLICATE_OPERATION_KEY',
        pathPrefix,
        `Duplicate operation key: ${key}.`,
      );
    }
    seenKeys.add(key);

    if (!timeoutMs) {
      pushIssue(
        issues,
        'MISSING_OPERATION_TIMEOUT',
        `${pathPrefix}.timeoutMs`,
        'Operation timeoutMs is required.',
      );
    }
    if (!getString(operation, 'handlerName')) {
      pushIssue(
        issues,
        'MISSING_OPERATION_HANDLER',
        `${pathPrefix}.handlerName`,
        'Operation handlerName is required.',
      );
    }

    return {
      aliases: getStringArray(operation, 'aliases'),
      description: getString(operation, 'description'),
      handlerName: getString(operation, 'handlerName') || '',
      inputSchema: isPlainObject(operation.inputSchema)
        ? operation.inputSchema
        : undefined,
      key,
      name: getString(operation, 'name') || key,
      outputSchema: isPlainObject(operation.outputSchema)
        ? operation.outputSchema
        : undefined,
      permissions: normalizePermissions(
        operation.permissions,
        `${pathPrefix}.permissions`,
        issues,
      ),
      timeoutMs: timeoutMs || 1000,
    };
  });
};

const parseEvents = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginEventManifest[] => {
  const events = Array.isArray(source.events) ? source.events : [];
  const seenKeys = new Set<string>();

  return events.filter(isPlainObject).map((event, index) => {
    const pathPrefix = `events[${index}]`;
    const key = getString(event, 'key') || '';

    requireKey(key, `${pathPrefix}.key`, issues);
    if (seenKeys.has(key)) {
      pushIssue(
        issues,
        'DUPLICATE_EVENT_KEY',
        pathPrefix,
        `Duplicate event key: ${key}.`,
      );
    }
    seenKeys.add(key);
    if (!getString(event, 'handlerName')) {
      pushIssue(
        issues,
        'MISSING_EVENT_HANDLER',
        `${pathPrefix}.handlerName`,
        'Event handlerName is required.',
      );
    }

    return {
      description: getString(event, 'description'),
      eventName: getString(event, 'eventName') || '',
      handlerName: getString(event, 'handlerName') || '',
      key,
      name: getString(event, 'name') || key,
    };
  });
};

const parseTasks = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginTaskManifest[] => {
  const tasks = Array.isArray(source.tasks) ? source.tasks : [];
  const seenKeys = new Set<string>();

  return tasks.filter(isPlainObject).map((task, index) => {
    const pathPrefix = `tasks[${index}]`;
    const key = getString(task, 'key') || '';
    const timeoutMs = getNumber(task, 'timeoutMs');
    let defaultCron = getString(task, 'defaultCron') || '';

    requireKey(key, `${pathPrefix}.key`, issues);
    if (seenKeys.has(key)) {
      pushIssue(
        issues,
        'DUPLICATE_TASK_KEY',
        pathPrefix,
        `Duplicate task key: ${key}.`,
      );
    }
    seenKeys.add(key);

    if (!getString(task, 'handlerName')) {
      pushIssue(
        issues,
        'MISSING_TASK_HANDLER',
        `${pathPrefix}.handlerName`,
        'Task handlerName is required.',
      );
    }
    if (!timeoutMs) {
      pushIssue(
        issues,
        'MISSING_TASK_TIMEOUT',
        `${pathPrefix}.timeoutMs`,
        'Task timeoutMs is required.',
      );
    }
    try {
      defaultCron = normalizeQqbotPluginTaskCron(defaultCron);
    } catch (error) {
      pushIssue(
        issues,
        'INVALID_TASK_CRON',
        `${pathPrefix}.defaultCron`,
        error instanceof Error ? error.message : 'Task cron is invalid.',
      );
    }

    return {
      defaultCron,
      description: getString(task, 'description'),
      enabled: task.enabled !== false,
      handlerName: getString(task, 'handlerName') || '',
      key,
      name: getString(task, 'name') || key,
      permissions: normalizePermissions(
        task.permissions,
        `${pathPrefix}.permissions`,
        issues,
      ),
      timeoutMs: timeoutMs || 1000,
    };
  });
};

const parseAssets = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginAssetManifest[] => {
  const assets = Array.isArray(source.assets) ? source.assets : [];

  return assets.filter(isPlainObject).map((asset, index) => {
    const key = getString(asset, 'key') || '';
    if (!key) {
      pushIssue(
        issues,
        'MISSING_ASSET_KEY',
        `assets[${index}].key`,
        'Asset key is required.',
      );
    }
    return {
      contentHash: getString(asset, 'contentHash'),
      key,
      path: normalizePackagePath(asset.path, `assets[${index}].path`, issues),
    };
  });
};

const parseMigrations = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
): QqbotPluginMigrationManifest[] => {
  const migrations = Array.isArray(source.migrations) ? source.migrations : [];

  return migrations.filter(isPlainObject).map((migration, index) => {
    const version = getString(migration, 'version') || '';
    requireSemver(version, `migrations[${index}].version`, issues);
    return {
      path: normalizePackagePath(
        migration.path,
        `migrations[${index}].path`,
        issues,
      ),
      version,
    };
  });
};

const parseLegacyAliases = (
  source: Record<string, unknown>,
  issues: QqbotPluginManifestValidationIssue[],
) => {
  return getStringArray(source, 'legacyAliases').filter((alias, index) => {
    if (!legacyAliasPattern.test(alias)) {
      pushIssue(
        issues,
        'INVALID_LEGACY_ALIAS',
        `legacyAliases[${index}]`,
        'Legacy alias must be a simple historical plugin key.',
      );
      return false;
    }
    return true;
  });
};

export const parseQqbotPluginManifest = (
  manifestLike: unknown,
  options: QqbotPluginManifestParseOptions = {},
): QqbotPluginManifest => {
  void options;

  const issues: QqbotPluginManifestValidationIssue[] = [];

  if (!isPlainObject(manifestLike)) {
    throw new QqbotPluginManifestValidationError([
      {
        code: 'INVALID_MANIFEST',
        message: 'Manifest must be a JSON object.',
        path: '$',
      },
    ]);
  }

  const pluginKey = getString(manifestLike, 'pluginKey') || '';
  if (!pluginKeyPattern.test(pluginKey)) {
    pushIssue(
      issues,
      'INVALID_PLUGIN_KEY',
      'pluginKey',
      'Plugin key must be lower-case kebab-case.',
    );
  }

  const version = getString(manifestLike, 'version') || '';
  const minApiSdkVersion = getString(manifestLike, 'minApiSdkVersion') || '';
  requireSemver(version, 'version', issues);
  requireSemver(minApiSdkVersion, 'minApiSdkVersion', issues);

  const parsedManifest: QqbotPluginManifest = {
    assets: parseAssets(manifestLike, issues),
    author: getString(manifestLike, 'author'),
    configSchema: isPlainObject(manifestLike.configSchema)
      ? manifestLike.configSchema
      : {},
    description: getString(manifestLike, 'description'),
    entry: normalizePackagePath(manifestLike.entry, 'entry', issues),
    events: parseEvents(manifestLike, issues),
    homepage: getString(manifestLike, 'homepage'),
    legacyAliases: parseLegacyAliases(manifestLike, issues),
    license: getString(manifestLike, 'license'),
    migrations: parseMigrations(manifestLike, issues),
    minApiSdkVersion,
    name: getString(manifestLike, 'name') || pluginKey,
    operations: parseOperations(manifestLike, issues),
    permissions: normalizePermissions(
      manifestLike.permissions,
      'permissions',
      issues,
    ),
    pluginKey,
    runtime: parseRuntime(manifestLike, issues),
    tasks: parseTasks(manifestLike, issues),
    version,
  };

  if (issues.length > 0) {
    throw new QqbotPluginManifestValidationError(issues);
  }

  return parsedManifest;
};
