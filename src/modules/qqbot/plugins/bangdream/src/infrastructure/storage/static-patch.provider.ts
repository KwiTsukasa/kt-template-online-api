import * as path from 'path';
import { configPath } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import {
  readExcelFile,
  readJSON,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';

export class BangDreamStaticPatchProvider {
  /**
   * 初始化 BangDreamStaticPatchProvider 实例。
   * @param rootPath - BangDream路径；影响 constructor 的返回值。
   */
  constructor(private readonly rootPath: string = configPath) {}

  /**
   * 读取 BangDream 本地静态 JSON 修正数据。
   *
   * @param fileName - fileName 输入；影响 readJson 的返回值。
   */
  async readJson<T = unknown>(fileName: string): Promise<T> {
    return (await readJSON(path.join(this.rootPath, fileName))) as T;
  }

  /**
   * 读取 BangDream 本地静态 Excel 修正数据。
   *
   * @param fileName - fileName 输入；影响 readExcelRows 的返回值。
   */
  async readExcelRows<T = Record<string, unknown>>(
    fileName: string,
  ): Promise<T[]> {
    return (await readExcelFile(path.join(this.rootPath, fileName))) as T[];
  }
}

export const bangdreamStaticPatchProvider = new BangDreamStaticPatchProvider();
