import {
  readBangDreamExcelRows,
  readBangDreamJsonFile,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

export async function readJSON(filepath: string): Promise<object> {
  return (await readBangDreamJsonFile(filepath)) as object;
}

export async function readJSONFromBuffer(buffer: Buffer): Promise<object> {
  const rawstring = buffer.toString();
  const data: object = JSON.parse(rawstring);
  return data;
}

export async function readExcelFile<
  T extends Record<string, unknown> = Record<string, unknown>,
>(filePath: string): Promise<T[]> {
  return await readBangDreamExcelRows<T>(filePath);
}

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

export function formatNumber(num: number, length: number): string {
  const str = num.toString();
  if (str.length < length) {
    return str.padStart(length, '0');
  }

  return str;
}
