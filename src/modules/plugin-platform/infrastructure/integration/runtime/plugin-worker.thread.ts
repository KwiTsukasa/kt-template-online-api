import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import type {
  PluginPackageDescriptor,
  PluginRuntimeConfigSnapshot,
} from '@/modules/plugin-platform/infrastructure/integration/package/plugin-package.types';
import type { PluginWorkerRequest } from './worker-runtime.types';
import type { PluginWorkerRequestType } from './worker-runtime.types';

export type PluginWorkerCreatePluginOptions = {
  configSnapshot: PluginRuntimeConfigSnapshot;
  descriptor: PluginPackageDescriptor;
  host: Record<string, unknown>;
  installationId: string;
};

export type PluginWorkerPluginInstance = {
  activate?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
  executeOperation?: (
    operationKey: string,
    input: unknown,
  ) => Promise<unknown> | unknown;
  executeTask?: (
    taskKey: string,
    input: unknown,
    context?: unknown,
  ) => Promise<unknown> | unknown;
  handleEvent?: (
    eventKey: string,
    event: unknown,
  ) => Promise<unknown> | unknown;
  health?: () => Promise<unknown> | unknown;
  healthCheck?: () => Promise<unknown> | unknown;
  operations?: unknown[];
  tasks?: unknown[];
};

type PluginEntryModule = {
  createPlugin?: (input: {
    host: Record<string, unknown>;
    manifest: PluginPackageDescriptor['manifest'];
    normalizeError: (error: unknown, fallback?: string) => string;
    now: () => Date;
    runtime: {
      configSnapshot: PluginRuntimeConfigSnapshot;
      installationId: string;
    };
  }) => Promise<PluginWorkerPluginInstance> | PluginWorkerPluginInstance;
  default?: {
    createPlugin?: PluginEntryModule['createPlugin'];
  };
};

type ParentMessage =
  | {
      message: PluginWorkerRequest;
      requestId: string;
      type: 'request';
    }
  | {
      error?: { message?: string; name?: string; stack?: string };
      ok: boolean;
      requestId: string;
      result?: unknown;
      type: 'hostResponse';
    };

type PendingHostCall = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
};

type HostArgumentMapper = (...args: unknown[]) => Record<string, unknown>;

const HOST_ARGUMENT_MAPPERS: Record<string, HostArgumentMapper> = {
  getDictByKey: (dictCode) => ({ dictCode }),
  getDictItemsByKey: (dictCode) => ({ dictCode }),
  readAssetFile: (path) => ({ path }),
  readJsonFile: (path) => ({ path }),
  relationTree: (input) => ({ input }),
  renameFile: (from, to) => ({ from, to }),
  requestBuffer: (options) => ({ options }),
  requestJson: (options) => ({ options }),
  resolveRedirect: (input) => ({ input }),
  sleep: (ms) => ({ ms }),
  warn: (message) => ({ message }),
  writeJsonFile: (path, data) => ({ data, path }),
};

const port = parentPort;
const pendingHostCalls = new Map<string, PendingHostCall>();
const requireEntryModule = createRequire(__filename);
let plugin: PluginWorkerPluginInstance | undefined;

const WORKER_REQUEST_HANDLERS: Record<
  PluginWorkerRequestType,
  (message: PluginWorkerRequest) => Promise<unknown> | unknown
> = {
  load: (message) => loadPlugin(message),
  activate: async () => {
    await requirePlugin().activate?.();
    return { ok: true };
  },
  health: () => healthPlugin(),
  executeOperation: (message) => executeOperation(message),
  executeTask: (message) => executeTask(message),
  handleEvent: (message) => handleEvent(message),
  deactivate: () => ({ ok: true }),
  dispose: async () => {
    await plugin?.dispose?.();
    plugin = undefined;
    return { ok: true };
  },
};

/**
 * 加载受控插件入口并调用其 `createPlugin` 导出，以描述信息、宿主能力和配置快照创建运行实例。
 * @param options - 控制插件描述信息筛选、缓存或输出方式的可选项，包含 `descriptor`、`host`、`configSnapshot`、`installationId` 字段。
 * @returns 返回插件入口创建的运行实例。
 * @throws 当 `typeof createPlugin !== 'function'` 成立时拒绝当前输入并抛出 `Error`。
 */
export async function createPluginFromDescriptor(
  options: PluginWorkerCreatePluginOptions,
): Promise<PluginWorkerPluginInstance> {
  const moduleUrl = pathToFileURL(options.descriptor.entryFile).href;
  const entryModule = await importPluginEntryModule(
    moduleUrl,
    options.descriptor.entryFile,
  );
  const createPlugin =
    entryModule.createPlugin || entryModule.default?.createPlugin;

  if (typeof createPlugin !== 'function') {
    throw new Error('Plugin entry must export createPlugin(options)');
  }

  return createPlugin({
    host: options.host,
    manifest: options.descriptor.manifest,
    normalizeError,
    now: () => new Date(),
    runtime: {
      configSnapshot: options.configSnapshot,
      installationId: options.installationId,
    },
  });
}

if (port) {
  port.on('message', (message: ParentMessage) => {
    void handleParentMessage(message);
  });
}

/**
 * 根据`message`处理父级消息；当 `message.type === 'hostResponse'` 成立时直接结束且不产生返回值。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `type`、`message`、`requestId` 字段。
 */
async function handleParentMessage(message: ParentMessage) {
  if (message.type === 'hostResponse') {
    settleHostResponse(message);
    return;
  }

  try {
    const result = await handleWorkerRequest(message.message);
    port?.postMessage({
      ok: true,
      requestId: message.requestId,
      result,
      type: 'response',
    });
  } catch (error) {
    port?.postMessage({
      error: serializeError(error),
      ok: false,
      requestId: message.requestId,
      type: 'response',
    });
  }
}

/**
 * 根据`message`处理工作进程请求。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `type` 字段。
 * @returns 工作进程请求。
 */
async function handleWorkerRequest(message: PluginWorkerRequest) {
  return WORKER_REQUEST_HANDLERS[message.type](message);
}

/**
 * 按`message`读取插件；从 `getWorkerDescriptor` 读取插件。
 * @param message - 包含正文、发送目标与账号身份的待处理消息。
 * @returns 包含 `ok`、`pluginKey` 字段的插件。
 */
async function loadPlugin(message: PluginWorkerRequest) {
  const descriptor = getWorkerDescriptor();
  plugin = await createPluginFromDescriptor({
    configSnapshot: getWorkerConfigSnapshot(),
    descriptor,
    host: createHostFacade(),
    installationId: getWorkerInstallationId(message),
  });

  return {
    ok: true,
    pluginKey: descriptor.pluginKey,
  };
}

/**
 * 优先调用插件的 `health` 或兼容 `healthCheck`，均未实现时返回健康兜底状态。
 * @returns 返回插件健康检查结果；插件未实现检查入口时返回健康兜底对象。
 */
async function healthPlugin() {
  const loadedPlugin = requirePlugin();
  if (loadedPlugin.health) return loadedPlugin.health();
  if (loadedPlugin.healthCheck) return loadedPlugin.healthCheck();
  return { ok: true, status: 'healthy' };
}

/**
 * 根据`message`处理操作；当 `loadedPlugin.executeOperation` 成立时返回 `loadedPlugin.executeOperation(operationKey,…`。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `operationKey`、`operationId`、`input` 字段。
 * @returns 操作。
 * @throws 插件既未提供统一执行入口也未声明匹配能力时抛出 `Error`。
 */
async function executeOperation(message: PluginWorkerRequest) {
  const loadedPlugin = requirePlugin();
  const operationKey = requireRequestKey(
    message.operationKey || message.operationId,
    'Bot 插件能力缺少 operationKey',
  );

  if (loadedPlugin.executeOperation) {
    return loadedPlugin.executeOperation(operationKey, message.input);
  }

  const operation = findRuntimeCallable(loadedPlugin.operations, operationKey);
  if (operation) {
    return operation.execute(message.input || {});
  }

  throw new Error(`Bot 插件能力不存在：${operationKey}`);
}

/**
 * 根据`message`处理任务；当 `loadedPlugin.executeTask` 成立时返回 `loadedPlugin.executeTask(taskKey, message.i…`。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `taskKey`、`taskHandlerName`、`taskId`、`triggerType` 字段。
 * @returns 任务。
 * @throws 插件既未提供统一任务入口也未声明匹配任务时抛出 `Error`。
 */
async function executeTask(message: PluginWorkerRequest) {
  const loadedPlugin = requirePlugin();
  const taskKey = requireRequestKey(
    message.taskKey || message.taskHandlerName,
    'Bot 插件定时任务缺少 taskKey',
  );
  const context = {
    taskHandlerName: message.taskHandlerName,
    taskId: message.taskId,
    triggerType: message.triggerType,
  };

  if (loadedPlugin.executeTask) {
    return loadedPlugin.executeTask(taskKey, message.input, context);
  }

  const task = findRuntimeCallable(
    loadedPlugin.tasks,
    taskKey,
    message.taskHandlerName,
  );
  if (task) {
    return task.execute(message.input || {}, context);
  }

  throw new Error(`Bot 插件定时任务不存在：${taskKey}`);
}

/**
 * 根据`message`处理事件；先通过 `requirePlugin` 校验输入边界。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `eventKey`、`event` 字段。
 * @returns 满足事件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
async function handleEvent(message: PluginWorkerRequest) {
  const loadedPlugin = requirePlugin();
  const eventKey = requireRequestKey(
    message.eventKey,
    'Bot 插件事件缺少 eventKey',
  );

  if (!loadedPlugin.handleEvent) return false;
  return loadedPlugin.handleEvent(eventKey, message.event);
}

/**
 * 为已知宿主方法创建参数映射包装，并用 Proxy 将其他字符串方法转为动态宿主调用。
 * @returns 返回由 `Proxy` 构造的主机外观层。
 */
function createHostFacade(): Record<string, unknown> {
  const host: Record<string, unknown> = {};
  for (const method of Object.keys(HOST_ARGUMENT_MAPPERS)) {
    host[method] = (...args: unknown[]) =>
      callHost(method, HOST_ARGUMENT_MAPPERS[method](...args));
  }

  return new Proxy(host, {
    /**
     * 从宿主外观读取已注册方法；未知字符串属性动态包装为宿主调用，`then` 与符号属性保持空值。
     * @param target - 用于从宿主外观读取已注册方法的领域对象，包含 `property` 字段。
     * @param property - 决定从宿主外观读取已注册方法内容、边界或目标的 `property` 值。
     * @returns 返回已注册宿主方法或动态调用包装；符号属性、`then` 与缺失分支返回 `undefined`。
     */
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (property in target) return target[property];
      if (property === 'then') return undefined;
      return (...args: unknown[]) =>
        callHost(property, normalizeHostArgs(args));
    },
  });
}

/**
 * 通过受控桥接获取主机。
 * @param method - 决定通过受控桥接获取主机内容、边界或目标的 `method` 值。
 * @param args - 决定通过受控桥接获取主机内容、边界或目标的 `args` 值。
 * @returns 完成初始化并携带当前边界配置的通过受控桥接获取主机。
 */
function callHost<TResult = unknown>(
  method: string,
  args: Record<string, unknown>,
): Promise<TResult> {
  if (!port) {
    return Promise.reject(
      new Error('Bot plugin worker host port unavailable'),
    );
  }

  const requestId = `host-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise<TResult>((resolve, reject) => {
    pendingHostCalls.set(requestId, {
      reject,
      resolve: (value) => resolve(value as TResult),
    });
    port.postMessage({
      args,
      method,
      requestId,
      type: 'hostCall',
    });
  });
}

/**
 * 按请求标识移除待处理宿主调用，并依据响应状态兑现或拒绝对应 Promise。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `requestId`、`ok`、`result`、`error` 字段。
 */
function settleHostResponse(
  message: Extract<ParentMessage, { type: 'hostResponse' }>,
) {
  const pending = pendingHostCalls.get(message.requestId);
  if (!pending) return;
  pendingHostCalls.delete(message.requestId);

  if (message.ok) {
    pending.resolve(message.result);
    return;
  }

  pending.reject(deserializeError(message.error));
}

/**
 * 按当前运行态读取工作进程描述文件。
 * @returns 工作进程描述文件。
 * @throws 当 `!descriptor || typeof descriptor !== 'object'` 成立时拒绝当前输入并抛出 `Error`。
 */
function getWorkerDescriptor(): PluginPackageDescriptor {
  const descriptor = workerData?.descriptor;
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('Bot 插件 worker 缺少 descriptor');
  }
  return descriptor as PluginPackageDescriptor;
}

/**
 * 按当前运行态读取工作进程配置快照；当 `snapshot && typeof snapshot === 'object'` 成立时返回 `(snapshot as PluginRuntimeConfigSnapsh…`。
 * @returns 工作进程配置快照。
 */
function getWorkerConfigSnapshot(): PluginRuntimeConfigSnapshot {
  const snapshot = workerData?.configSnapshot;
  if (snapshot && typeof snapshot === 'object') {
    return (snapshot as PluginRuntimeConfigSnapshot);
  }
  return {};
}

/**
 * 按`message`读取工作进程安装标识；当 `typeof installationId === 'string'` 成立时返回 `installationId`。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `installationId` 字段。
 * @returns 当前状态对应的工作进程安装标识，取值为 `''`。
 */
function getWorkerInstallationId(message: PluginWorkerRequest) {
  const installationId = workerData?.installationId || message.installationId;
  if (typeof installationId === 'string') {
    return installationId;
  }
  return '';
}

/**
 * 校验当前运行态是否满足前置条件并返回必需插件约束，并拒绝不合法输入。
 * @returns 前置条件并返回必需插件。
 * @throws 当 `!plugin` 成立时拒绝当前输入并抛出 `Error`。
 */
function requirePlugin() {
  if (!plugin) {
    throw new Error('Bot 插件运行时未加载');
  }
  return plugin;
}

/**
 * 校验`value`、`message`是否满足必需请求键约束，并拒绝不合法输入。
 * @param value - 参与必需请求键比较、格式化或输出的候选值。
 * @param message - 包含正文、发送目标与账号身份的待处理消息。
 * @returns 必需请求键。
 * @throws 输入不是非空字符串时抛出调用方提供消息的 `Error`。
 */
function requireRequestKey(value: unknown, message: string) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(message);
}

/**
 * 按`items`、`key`、`handlerName`读取运行态可调用对象。
 * @param items - 按原有顺序参与运行态可调用对象筛选、合并或汇总的集合。
 * @param key - 用于读取或更新运行态可调用对象的稳定键。
 * @param handlerName - 决定运行态可调用对象内容、边界或目标的 `handlerName` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 运行态可调用对象。
 */
function findRuntimeCallable(
  items: unknown[] | undefined,
  key: string,
  handlerName?: string,
) {
  return items
    ?.filter(isRuntimeCallable)
    .find(
      (item) =>
        item.key === key ||
        item.handlerName === key ||
        (!!handlerName && item.handlerName === handlerName),
    );
}

/**
 * 根据`item`与当前约束判定运行态可调用对象。
 * @param item - 决定运行态可调用对象内容、边界或目标的 `item` 值。
 * @returns 满足运行态可调用对象约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isRuntimeCallable(item: unknown): item is {
  execute: (input: unknown, context?: unknown) => Promise<unknown> | unknown;
  handlerName?: string;
  key?: string;
} {
  return (
    !!item &&
    typeof item === 'object' &&
    typeof (item as { execute?: unknown }).execute === 'function'
  );
}

/**
 * 将`args`规范为主机参数，使等价输入得到一致表示。
 * @param args - 用于主机参数的领域对象，包含 `length`、`0` 字段。
 * @returns 包含 `args` 字段的主机参数。
 */
function normalizeHostArgs(args: unknown[]): Record<string, unknown> {
  if (args.length === 1 && isRecord(args[0])) return args[0];
  return { args };
}

/**
 * 根据`value`与当前约束判定记录。
 * @param value - 待判定是否满足记录约束的候选值。
 * @returns 满足记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 以统一异常拒绝插件条目模块。
 * @param moduleUrl - 待规范化、请求或同源校验的moduleURL 地址 URL。
 * @param entryFile - 决定以统一异常拒绝插件条目模块内容、边界或目标的 `entryFile` 值。
 * @returns 以统一异常拒绝插件条目模块。
 * @throws 当 `!shouldFallbackToRequire(error, moduleUrl)` 成立时重新抛出该入口捕获且决定公开的原异常。
 */
async function importPluginEntryModule(moduleUrl: string, entryFile: string) {
  try {
    return await dynamicImportPluginEntry(moduleUrl);
  } catch (error) {
    if (!shouldFallbackToRequire(error, moduleUrl)) {
      throw error;
    }
    if (entryFile.endsWith('.js') || entryFile.endsWith('.cjs')) {
      return loadCommonJsEntryModule(entryFile);
    }
    return requireEntryModule(entryFile) as PluginEntryModule;
  }
}

/**
 * 通过可替换导入器加载插件条目。
 * @param moduleUrl - 待规范化、请求或同源校验的moduleURL 地址 URL。
 * @returns 通过可替换导入器加载插件条目。
 */
function dynamicImportPluginEntry(
  moduleUrl: string,
): Promise<PluginEntryModule> {
  const importer = new Function('moduleUrl', 'return import(moduleUrl)') as (
    value: string,
  ) => Promise<PluginEntryModule>;
  return importer(moduleUrl);
}

/**
 * 仅对本地文件模块 URL 且动态导入报告不支持扩展名时启用 CommonJS `require` 兜底。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @param moduleUrl - 待规范化、请求或同源校验的moduleURL 地址 URL。
 * @returns 返回是否应从动态导入切换到 CommonJS 加载路径。
 */
function shouldFallbackToRequire(error: unknown, moduleUrl: string) {
  if (!moduleUrl.startsWith('file:')) return false;
  const message = (() => {
    if (error instanceof Error) {
      return error.message;
    }
    return `${error}`;
  })();
  return (
    message.includes('Cannot find module') ||
    message.includes('dynamic import callback') ||
    message.includes('Unknown file extension')
  );
}

/**
 * 按`entryFile`读取CommonJS条目模块；先通过 `requireEntryModule` 校验输入边界。
 * @param entryFile - 决定CommonJS条目模块内容、边界或目标的 `entryFile` 值。
 * @returns CommonJS条目模块。
 */
function loadCommonJsEntryModule(entryFile: string): PluginEntryModule {
  const nodeModule = requireEntryModule(
    'node:module',
  ) as typeof import('node:module');
  const moduleConstructor = nodeModule.Module as typeof nodeModule.Module & {
    _nodeModulePaths: (from: string) => string[];
  };
  const entryModule = new moduleConstructor(entryFile);
  entryModule.filename = entryFile;
  entryModule.paths = moduleConstructor._nodeModulePaths(dirname(entryFile));
  (
    entryModule as typeof entryModule & {
      _compile: (content: string, filename: string) => void;
    }
  )._compile(readFileSync(entryFile, 'utf8'), entryFile);
  return entryModule.exports as PluginEntryModule;
}

/**
 * 将`error`、`fallback`规范为错误，使等价输入得到一致表示。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `'插件执行失败'`。
 * @returns 规范化后的错误；主值为空时采用 `fallback` 兜底。
 */
function normalizeError(error: unknown, fallback = '插件执行失败') {
  if (error instanceof Error && error.message) return error.message;
  const message = `${error || ''}`.trim();
  return message || fallback;
}

/**
 * 序列化错误，并输出固定投影 `message`、`name`、`stack` 字段。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 包含 `message`、`name`、`stack` 字段的错误。
 */
function serializeError(error: unknown) {
  return {
    message: (() => {
      if (error instanceof Error) {
        return error.message;
      }
      return `${error}`;
    })(),
    name: (() => {
      if (error instanceof Error) {
        return error.name;
      }
      return 'Error';
    })(),
    stack: (() => {
      if (error instanceof Error) {
        return error.stack;
      }
      return undefined;
    })(),
  };
}

/**
 * 根据`error`处理反序列化错误。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常；为空时采用 `'插件 Host 调用失败'` 作为兜底。
 * @returns 反序列化错误。
 */
function deserializeError(error?: {
  message?: string;
  name?: string;
  stack?: string;
}) {
  const output = new Error(error?.message || '插件 Host 调用失败');
  if (error?.name) output.name = error.name;
  if (error?.stack) output.stack = error.stack;
  return output;
}
