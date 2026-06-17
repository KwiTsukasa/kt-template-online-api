import {
  readBangDreamExcelRows,
  readBangDreamJsonFile,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

/**
 * 读取 BangDream 插件资源。
 * @param filepath - BangDream路径；影响 readJSON 的返回值。
 * @returns 异步完成后的 BangDream 插件结果。
 */
export async function readJSON(filepath: string): Promise<object> {
  return (await readBangDreamJsonFile(filepath)) as object;
}

/**
 * 读取 BangDream 插件资源。
 * @param buffer - buffer 输入；生成规范化文本。
 * @returns 异步完成后的 BangDream 插件结果。
 */
export async function readJSONFromBuffer(buffer: Buffer): Promise<object> {
  const rawstring = buffer.toString();
  const data: object = JSON.parse(rawstring);
  return data;
}

/**
 * 读取 BangDream 插件资源。
 * @param filePath - BangDream路径；影响 readExcelFile 的返回值。
 * @returns 异步完成后的 BangDream 插件结果。
 */
export async function readExcelFile<
  T extends Record<string, unknown> = Record<string, unknown>,
>(filePath: string): Promise<T[]> {
  return await readBangDreamExcelRows<T>(filePath);
}

/**
 * 执行 BangDream 插件流程。
 * @param stringArray - stringArray 输入；使用 `length` 字段生成结果。
 * @returns BangDream 插件产出的 number[]。
 */
export function stringToNumberArray(
  stringArray: Array<string | null>,
): number[] {
  const numberArray: number[] = [];
  for (let i = 0; i < stringArray.length; i++) {
    if (stringArray[i] == null) {
      numberArray.push(null);
    } else {
      numberArray.push(Number(stringArray[i]));
    }
  }
  return numberArray;
}

/**
 * 转换 BangDream 插件输入。
 * @param num - num 输入；生成规范化文本。
 * @param length - length 输入；驱动 `str.padStart()` 的 BangDream步骤。
 * @returns BangDream 插件渲染后的图片、画布或文本。
 */
export function formatNumber(num: number, length: number): string {
  const str = num.toString();
  if (str.length < length) {
    return str.padStart(length, '0');
  }

  return str;
}
