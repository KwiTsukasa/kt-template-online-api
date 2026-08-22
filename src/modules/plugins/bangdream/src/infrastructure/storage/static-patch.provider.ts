import * as path from 'path';
import { configPath } from '@/modules/plugins/bangdream/src/config/runtime-config';
import {
  readExcelFile,
  readJSON,
} from '@/modules/plugins/bangdream/src/domain/common/model-utils';

export class BangDreamStaticPatchProvider {
  constructor(private readonly rootPath: string = configPath) {}

  /**
   * 按`fileName`读取JSON 数据；从 `readJSON` 读取JSON 数据。
   * @param fileName - 决定JSON 数据内容、边界或目标的 `fileName` 值。
   * @returns JSON 数据。
   */
  async readJson<T = unknown>(fileName: string): Promise<T> {
    return (await readJSON(path.join(this.rootPath, fileName))) as T;
  }

  /**
   * 按`fileName`读取Excel 表格Rows；从 `readExcelFile` 读取Excel 表格Rows。
   * @param fileName - 决定Excel 表格Rows内容、边界或目标的 `fileName` 值。
   * @returns 按输入顺序得到的Excel 表格Rows列表；没有匹配项时为空数组。
   */
  async readExcelRows<T = Record<string, unknown>>(
    fileName: string,
  ): Promise<T[]> {
    return (await readExcelFile(path.join(this.rootPath, fileName))) as T[];
  }
}

export const bangdreamStaticPatchProvider = new BangDreamStaticPatchProvider();
