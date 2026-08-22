import * as path from 'path';
import { normalizePluginTaskCron } from '../../application/task/plugin-task-cron.validator';
import {
  PLUGIN_ALLOWED_PERMISSIONS,
  PLUGIN_WORKER_TYPES,
  type PluginAssetManifest,
  type PluginEventManifest,
  type PluginManifest,
  type PluginManifestParseOptions,
  type PluginManifestValidationIssue,
  type PluginMigrationManifest,
  type PluginOperationManifest,
  type PluginPermission,
  type PluginRuntimeManifest,
  type PluginTaskManifest,
  type PluginWorkerType,
} from './manifest.types';

const pluginKeyPattern = /^[a-z][a-z0-9-]{2,63}$/;
const legacyAliasPattern = /^[A-Za-z][A-Za-z0-9-]{2,63}$/;
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const capabilityKeyPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const windowsAbsolutePathPattern = /^[a-zA-Z]:[\\/]/;

const allowedPermissionSet = new Set<string>(PLUGIN_ALLOWED_PERMISSIONS);
const allowedWorkerTypeSet = new Set<string>(PLUGIN_WORKER_TYPES);

export class PluginManifestValidationError extends Error {
  constructor(readonly issues: PluginManifestValidationIssue[]) {
    super(
      `Bot plugin manifest validation failed: ${issues
        .map((issue) => `${issue.path}:${issue.code}`)
        .join(', ')}`,
    );
    this.name = 'PluginManifestValidationError';
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
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return undefined;
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

/**
 * 从`rawKeys`解析配置键；当 `!Array.isArray(rawKeys)` 成立时返回 `[]`。
 * @param rawKeys - 用于批量校验或读取配置键的键集合。
 * @returns 按输入顺序得到的配置键列表；没有匹配项时为空数组。
 */
function parseConfigKeys(rawKeys: unknown): string[] {
  if (!Array.isArray(rawKeys)) {
    return [];
  }

  return Array.from(
    new Set(
      rawKeys
        .filter((key): key is string => typeof key === 'string')
        .map((key) => key.trim())
        .filter((key) => key.length > 0),
    ),
  );
}

const getNumber = (
  source: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

const pushIssue = (
  issues: PluginManifestValidationIssue[],
  code: string,
  pathName: string,
  message: string,
) => {
  issues.push({ code, message, path: pathName });
};

const normalizePackagePath = (
  value: unknown,
  pathName: string,
  issues: PluginManifestValidationIssue[],
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
  issues: PluginManifestValidationIssue[],
): PluginPermission[] => {
  if (!Array.isArray(value)) return [];

  const result: PluginPermission[] = [];
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

    if (!result.includes(permission as PluginPermission)) {
      result.push(permission as PluginPermission);
    }
  });

  return result;
};

const requireSemver = (
  value: string | undefined,
  pathName: string,
  issues: PluginManifestValidationIssue[],
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
  issues: PluginManifestValidationIssue[],
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
  issues: PluginManifestValidationIssue[],
): PluginRuntimeManifest => {
  const runtime = (() => {
    if (isPlainObject(source.runtime)) {
      return source.runtime;
    }
    return {};
  })();
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
    configKeys: parseConfigKeys(runtime.configKeys),
    maxConcurrency: maxConcurrency || 1,
    memoryMb: memoryMb || 128,
    timeoutMs: timeoutMs || 1000,
    workerType: (workerType || 'node-worker') as PluginWorkerType,
  };
};

const parseOperations = (
  source: Record<string, unknown>,
  issues: PluginManifestValidationIssue[],
): PluginOperationManifest[] => {
  const operations = (() => {
    if (Array.isArray(source.operations)) {
      return source.operations;
    }
    return [];
  })();
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
      inputSchema: (() => {
        if (isPlainObject(operation.inputSchema)) {
          return operation.inputSchema;
        }
        return undefined;
      })(),
      key,
      name: getString(operation, 'name') || key,
      outputSchema: (() => {
        if (isPlainObject(operation.outputSchema)) {
          return operation.outputSchema;
        }
        return undefined;
      })(),
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
  issues: PluginManifestValidationIssue[],
): PluginEventManifest[] => {
  const events = (() => {
    if (Array.isArray(source.events)) {
      return source.events;
    }
    return [];
  })();
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
  issues: PluginManifestValidationIssue[],
): PluginTaskManifest[] => {
  const tasks = (() => {
    if (Array.isArray(source.tasks)) {
      return source.tasks;
    }
    return [];
  })();
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
      defaultCron = normalizePluginTaskCron(defaultCron);
    } catch (error) {
      pushIssue(
        issues,
        'INVALID_TASK_CRON',
        `${pathPrefix}.defaultCron`,
        (() => {
          if (error instanceof Error) {
            return error.message;
          }
          return 'Task cron is invalid.';
        })(),
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
  issues: PluginManifestValidationIssue[],
): PluginAssetManifest[] => {
  const assets = (() => {
    if (Array.isArray(source.assets)) {
      return source.assets;
    }
    return [];
  })();

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
  issues: PluginManifestValidationIssue[],
): PluginMigrationManifest[] => {
  const migrations = (() => {
    if (Array.isArray(source.migrations)) {
      return source.migrations;
    }
    return [];
  })();

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
  issues: PluginManifestValidationIssue[],
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

export const parsePluginManifest = (
  manifestLike: unknown,
  options: PluginManifestParseOptions = {},
): PluginManifest => {
  void options;

  const issues: PluginManifestValidationIssue[] = [];

  if (!isPlainObject(manifestLike)) {
    throw new PluginManifestValidationError([
      {
        code: 'INVALID_MANIFEST',
        message: 'Manifest must be a JSON object.',
        path: '$',
      },
    ]);
  }

  const pluginKey =
    getString(manifestLike, 'key') || getString(manifestLike, 'pluginKey') || '';
  const pluginKeyPath = (() => {
    if (getString(manifestLike, 'key')) {
      return 'key';
    }
    return 'pluginKey';
  })();
  if (!pluginKeyPattern.test(pluginKey)) {
    pushIssue(
      issues,
      'INVALID_PLUGIN_KEY',
      pluginKeyPath,
      'Plugin key must be lower-case kebab-case.',
    );
  }

  const version = getString(manifestLike, 'version') || '';
  const minApiSdkVersion =
    getString(manifestLike, 'minApiSdkVersion') || '1.0.0';
  requireSemver(version, 'version', issues);
  requireSemver(minApiSdkVersion, 'minApiSdkVersion', issues);

  const parsedManifest: PluginManifest = {
    assets: parseAssets(manifestLike, issues),
    author: getString(manifestLike, 'author'),
    configSchema: (() => {
      if (isPlainObject(manifestLike.configSchema)) {
        return manifestLike.configSchema;
      }
      return {};
    })(),
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
    key: pluginKey,
    pluginKey,
    runtime: parseRuntime(manifestLike, issues),
    tasks: parseTasks(manifestLike, issues),
    version,
  };

  if (issues.length > 0) {
    throw new PluginManifestValidationError(issues);
  }

  return parsedManifest;
};
