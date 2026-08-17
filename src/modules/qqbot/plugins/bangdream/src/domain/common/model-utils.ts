import {
  readBangDreamExcelRows,
  readBangDreamJsonFile,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

/**
 * 按`filepath`读取JSON 数据；从 `readBangDreamJsonFile` 读取JSON 数据。
 * @param filepath - 决定JSON 数据内容、边界或目标的 `filepath` 值。
 * @returns JSON 数据。
 */
export async function readJSON(filepath: string): Promise<object> {
  return (await readBangDreamJsonFile(filepath)) as object;
}

/**
 * 通过 `buffer.toString` 收敛领域表示。
 * @param buffer - 用于JSONFrom缓冲区的领域对象，包含 `toString` 字段。
 * @returns JSONFrom缓冲区。
 */
export async function readJSONFromBuffer(buffer: Buffer): Promise<object> {
  const rawstring = buffer.toString();
  const data: object = JSON.parse(rawstring);
  return data;
}

/**
 * 按`filePath`读取Excel 表格文件；从 `readBangDreamExcelRows` 读取Excel 表格文件。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns 按输入顺序得到的Excel 表格文件列表；没有匹配项时为空数组。
 */
export async function readExcelFile<
  T extends Record<string, unknown> = Record<string, unknown>,
>(filePath: string): Promise<T[]> {
  return await readBangDreamExcelRows<T>(filePath);
}

/**
 * 逐项将字符串转换为数字并保留 `null` 占位，输出顺序与输入一致。
 * @param stringArray - 用于逐项将字符串转换为数字并保留 `null` 占位，输出顺序与输入一致的领域对象，包含 `length`、`i` 字段。
 * @returns 按输入顺序得到的逐项将字符串转换为数字并保留 `null` 占位，输出顺序与输入一致列表；没有匹配项时为空数组。
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
 * 将数字转为文本；长度不足指定位数时在左侧补零，已达长度时保留原文本。
 * @param num - 用于将数字转为文本的领域对象，包含 `toString` 字段。
 * @param length - 决定将数字转为文本内容、边界或目标的 `length` 值。
 * @returns 将数字转为文本。
 */
export function formatNumber(num: number, length: number): string {
  const str = num.toString();
  if (str.length < length) {
    return str.padStart(length, '0');
  }

  return str;
}
