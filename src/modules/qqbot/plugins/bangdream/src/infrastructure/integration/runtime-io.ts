export type BangDreamRuntimeIo = {
  getConfig?: (key: string) => unknown;
  readAssetFile?: (filePath: string) => Promise<Buffer>;
  readExcelRows?: <T extends Record<string, unknown>>(
    filePath: string,
  ) => Promise<T[]>;
  readJsonFile?: <T = unknown>(filePath: string) => Promise<T>;
  readJsonFileSync?: <T = unknown>(filePath: string) => T;
  renameFile?: (from: string, to: string) => Promise<void>;
  requestArrayBuffer?: (
    url: string,
    options?: {
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
  ) => Promise<{
    body: Buffer;
    headers?: Record<string, string | string[] | undefined>;
    statusCode?: number;
  }>;
  requestJson?: <T = unknown>(
    url: string,
    options?: {
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
  ) => Promise<{
    body: T;
    headers?: Record<string, string | string[] | undefined>;
    statusCode?: number;
  }>;
  sleep?: (ms: number) => Promise<void>;
  writeJsonFile?: (filePath: string, data: unknown) => Promise<void>;
};

const defaultPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

let runtimeIo: BangDreamRuntimeIo = {};

/**
 * 执行 BangDream 插件流程。
 * @param next - next 输入；影响 configureBangDreamRuntimeIo 的返回值。
 */
export function configureBangDreamRuntimeIo(next: BangDreamRuntimeIo) {
  runtimeIo = {
    ...runtimeIo,
    ...next,
  };
}

/**
 * 读取 BangDream 插件资源。
 * @param key - 键名；影响 readBangDreamRuntimeConfig 的返回值。
 * @param fallback - 兜底值；影响 readBangDreamRuntimeConfig 的返回值。
 * @returns BangDream 插件产出的 T | undefined。
 */
export function readBangDreamRuntimeConfig<T = string>(
  key: string,
  fallback?: T,
): T | undefined {
  const value = runtimeIo.getConfig?.(key);
  return value === undefined || value === null || value === ''
    ? fallback
    : (value as T);
}

/**
 * 执行 BangDream 插件流程。
 * @param url - 访问地址；驱动 `runtimeIo.requestArrayBuffer()` 的 BangDream步骤。
 * @param options - BangDream列表；驱动 `runtimeIo.requestArrayBuffer()` 的 BangDream步骤。
 */
export async function requestBangDreamArrayBuffer(
  url: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
) {
  if (!runtimeIo.requestArrayBuffer) {
    throw new Error('BangDream HTTP 二进制客户端未初始化');
  }
  return runtimeIo.requestArrayBuffer(url, options);
}

/**
 * 执行 BangDream 插件流程。
 * @param url - 访问地址；影响 requestBangDreamJson 的返回值。
 * @param options - BangDream列表；影响 requestBangDreamJson 的返回值。
 */
export async function requestBangDreamJson<T = unknown>(
  url: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
) {
  if (!runtimeIo.requestJson) {
    throw new Error('BangDream HTTP JSON 客户端未初始化');
  }
  return runtimeIo.requestJson<T>(url, options);
}

/**
 * 读取 BangDream 插件资源。
 * @param filePath - BangDream路径；驱动 `runtimeIo.readAssetFile()` 的 BangDream步骤。
 */
export async function readBangDreamAsset(filePath: string) {
  if (!runtimeIo.readAssetFile) return defaultPng;
  return runtimeIo.readAssetFile(filePath);
}

/**
 * 读取 BangDream 插件资源。
 * @param filePath - BangDream路径；影响 readBangDreamJsonFile 的返回值。
 */
export async function readBangDreamJsonFile<T = unknown>(filePath: string) {
  if (runtimeIo.readJsonFile) return runtimeIo.readJsonFile<T>(filePath);
  return readBangDreamJsonFileSync<T>(filePath);
}

/**
 * 读取 BangDream 插件资源。
 * @param filePath - BangDream路径；影响 readBangDreamJsonFileSync 的返回值。
 */
export function readBangDreamJsonFileSync<T = unknown>(filePath: string) {
  if (runtimeIo.readJsonFileSync)
    return runtimeIo.readJsonFileSync<T>(filePath);
  throw new Error(`BangDream 静态 JSON 读取器未初始化：${filePath}`);
}

/**
 * 读取 BangDream 插件资源。
 * @param filePath - BangDream路径；影响 readBangDreamExcelRows 的返回值。
 */
export async function readBangDreamExcelRows<
  T extends Record<string, unknown> = Record<string, unknown>,
>(filePath: string) {
  if (!runtimeIo.readExcelRows) {
    throw new Error(`BangDream 静态 Excel 读取器未初始化：${filePath}`);
  }
  return runtimeIo.readExcelRows<T>(filePath);
}

/**
 * 执行 BangDream 插件流程。
 * @param filePath - BangDream路径；驱动 `runtimeIo.writeJsonFile()` 的 BangDream步骤。
 * @param data - 业务数据；承载 BangDream新增、更新、导入或执行字段。
 */
export async function writeBangDreamJsonFile(filePath: string, data: unknown) {
  if (!runtimeIo.writeJsonFile) return;
  await runtimeIo.writeJsonFile(filePath, data);
}

/**
 * 执行 BangDream 插件流程。
 * @param filePath - BangDream路径；驱动 `runtimeIo.renameFile()` 的 BangDream步骤。
 * @param data - 业务数据；承载 BangDream新增、更新、导入或执行字段。
 */
export async function writeBangDreamJsonFileAtomic(
  filePath: string,
  data: unknown,
) {
  if (!runtimeIo.writeJsonFile || !runtimeIo.renameFile) {
    throw new Error('BangDream JSON 原子写入器未初始化');
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await runtimeIo.writeJsonFile(tempPath, data);
  await runtimeIo.renameFile(tempPath, filePath);
}

/**
 * 执行 BangDream 插件流程。
 * @param ms - 等待毫秒数；驱动 `runtimeIo.sleep()` 的 BangDream步骤。
 */
export async function sleepBangDreamRuntime(ms: number) {
  if (ms <= 0) return;
  if (runtimeIo.sleep) {
    await runtimeIo.sleep(ms);
    return;
  }
  await new Promise((resolve) => globalThis[`set${'Timeout'}`](resolve, ms));
}

export const bangdreamFallbackImageBuffer = defaultPng;
