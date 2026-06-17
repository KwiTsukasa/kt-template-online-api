import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * 查询 当前模块数据。
   * @returns 当前模块查询结果。
   */
  getHello(): string {
    return 'Hello World!';
  }
}
