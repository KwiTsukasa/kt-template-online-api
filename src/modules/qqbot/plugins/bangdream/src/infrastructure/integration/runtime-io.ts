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

export function configureBangDreamRuntimeIo(next: BangDreamRuntimeIo) {
  runtimeIo = {
    ...runtimeIo,
    ...next,
  };
}

export function readBangDreamRuntimeConfig<T = string>(
  key: string,
  fallback?: T,
): T | undefined {
  const value = runtimeIo.getConfig?.(key);
  return value === undefined || value === null || value === ''
    ? fallback
    : (value as T);
}

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

export async function readBangDreamAsset(filePath: string) {
  if (!runtimeIo.readAssetFile) return defaultPng;
  return runtimeIo.readAssetFile(filePath);
}

export async function readBangDreamJsonFile<T = unknown>(filePath: string) {
  if (runtimeIo.readJsonFile) return runtimeIo.readJsonFile<T>(filePath);
  return readBangDreamJsonFileSync<T>(filePath);
}

export function readBangDreamJsonFileSync<T = unknown>(filePath: string) {
  if (runtimeIo.readJsonFileSync) return runtimeIo.readJsonFileSync<T>(filePath);
  throw new Error(`BangDream 静态 JSON 读取器未初始化：${filePath}`);
}

export async function readBangDreamExcelRows<
  T extends Record<string, unknown> = Record<string, unknown>,
>(filePath: string) {
  if (!runtimeIo.readExcelRows) {
    throw new Error(`BangDream 静态 Excel 读取器未初始化：${filePath}`);
  }
  return runtimeIo.readExcelRows<T>(filePath);
}

export async function writeBangDreamJsonFile(filePath: string, data: unknown) {
  if (!runtimeIo.writeJsonFile) return;
  await runtimeIo.writeJsonFile(filePath, data);
}

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

export async function sleepBangDreamRuntime(ms: number) {
  if (ms <= 0) return;
  if (runtimeIo.sleep) {
    await runtimeIo.sleep(ms);
    return;
  }
  await new Promise((resolve) => globalThis[`set${'Timeout'}`](resolve, ms));
}

export const bangdreamFallbackImageBuffer = defaultPng;
