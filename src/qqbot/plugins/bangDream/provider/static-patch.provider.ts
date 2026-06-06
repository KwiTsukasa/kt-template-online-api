import * as path from 'path';
import { configPath } from '@/qqbot/plugins/bangDream/config/runtime-config';
import {
  readExcelFile,
  readJSON,
} from '@/qqbot/plugins/bangDream/shared/model-utils';

export class BangDreamStaticPatchProvider {
  constructor(private readonly rootPath: string = configPath) {}

  /**
   * 读取 Tsugu 本地静态 JSON 修正数据。
   *
   * @param fileName - static-config 下的 JSON 文件名。
   */
  async readJson<T = unknown>(fileName: string): Promise<T> {
    return (await readJSON(path.join(this.rootPath, fileName))) as T;
  }

  /**
   * 读取 Tsugu 本地静态 Excel 修正数据。
   *
   * @param fileName - static-config 下的 Excel 文件名。
   */
  async readExcelRows<T = Record<string, unknown>>(
    fileName: string,
  ): Promise<T[]> {
    return (await readExcelFile(path.join(this.rootPath, fileName))) as T[];
  }
}

export const bangDreamStaticPatchProvider =
  new BangDreamStaticPatchProvider();
