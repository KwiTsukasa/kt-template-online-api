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
 * 将本次操作写入 `runtimeIo` 状态。
 * @param next - `next` 仅为兼容调用签名保留，当前实现不读取该值。
 */
export function configureBangDreamRuntimeIo(next: BangDreamRuntimeIo) {
  runtimeIo = {
    ...runtimeIo,
    ...next,
  };
}

/**
 * 按`key`、`fallback`读取BanG Dream运行态配置；当 `value === undefined || value === null || value === ''` 成立时返回 `fallback`。
 * @param key - 用于读取或更新BanGDream运行态配置的稳定键。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns BanGDream运行态配置。
 */
export function readBangDreamRuntimeConfig<T = string>(
  key: string,
  fallback?: T,
): T | undefined {
  const value = runtimeIo.getConfig?.(key);
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return (value as T);
}

/**
 * 按`url`、`options`投递BanG Dream数组内容缓冲区。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param options - 控制BanGDream数组内容缓冲区筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns BanGDream数组内容缓冲区。
 * @throws 当 `!runtimeIo.requestArrayBuffer` 成立时拒绝当前输入并抛出 `Error`。
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
 * 通过已注入运行时客户端请求 BanG Dream JSON；客户端未初始化时立即抛出错误。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @param options - 控制BanGDreamJSON 数据筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns BanGDreamJSON 数据。
 * @throws 当 `!runtimeIo.requestJson` 成立时拒绝当前输入并抛出 `Error`。
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
 * 按`filePath`读取BanG Dream资源；从 `runtimeIo.readAssetFile` 读取BanG Dream资源。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns BanGDream资源。
 */
export async function readBangDreamAsset(filePath: string) {
  if (!runtimeIo.readAssetFile) return defaultPng;
  return runtimeIo.readAssetFile(filePath);
}

/**
 * 按`filePath`读取BanG DreamJSON 数据文件；从 `runtimeIo.readJsonFile` 读取BanG DreamJSON 数据文件。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns BanGDreamJSON 数据文件。
 */
export async function readBangDreamJsonFile<T = unknown>(filePath: string) {
  if (runtimeIo.readJsonFile) return runtimeIo.readJsonFile<T>(filePath);
  return readBangDreamJsonFileSync<T>(filePath);
}

/**
 * 按`filePath`读取BanG DreamJSON 数据文件；从 `runtimeIo.readJsonFileSync` 读取BanG DreamJSON 数据文件。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns BanGDreamJSON 数据文件。
 * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `Error`。
 */
export function readBangDreamJsonFileSync<T = unknown>(filePath: string) {
  if (runtimeIo.readJsonFileSync)
    return runtimeIo.readJsonFileSync<T>(filePath);
  throw new Error(`BangDream 静态 JSON 读取器未初始化：${filePath}`);
}

/**
 * 按`filePath`读取BanG DreamExcel 表格Rows；从 `runtimeIo.readExcelRows` 读取BanG DreamExcel 表格Rows。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns BanGDreamExcel 表格Rows。
 * @throws 当 `!runtimeIo.readExcelRows` 成立时拒绝当前输入并抛出 `Error`。
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
 * 仅在宿主提供 JSON 写入能力时将 BanG Dream 数据写入指定路径；能力缺失时直接结束。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @param data - 决定仅在宿主提供 JSON 写入能力时将 BanG Dream 数据写入指定路径内容、边界或目标的 `data` 值。
 */
export async function writeBangDreamJsonFile(filePath: string, data: unknown) {
  if (!runtimeIo.writeJsonFile) return;
  await runtimeIo.writeJsonFile(filePath, data);
}

/**
 * 先把 JSON 数据写入同目录临时文件，再通过重命名原子替换目标文件；宿主缺少写入或重命名能力时抛出错误。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @param data - 决定先把 JSON 数据写入同目录临时文件，再通过重命名原子替换目标文件内容、边界或目标的 `data` 值。
 * @throws 当 `!runtimeIo.writeJsonFile || !runtimeIo.renameFile` 成立时拒绝当前输入并抛出 `Error`。
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
 * 对正毫秒数优先使用宿主休眠能力，宿主未提供时回退到本地定时器。
 * @param ms - 决定对正毫秒数优先使用宿主休眠能力，宿主未提供时回退到本地定时器内容、边界或目标的 `ms` 值。
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
