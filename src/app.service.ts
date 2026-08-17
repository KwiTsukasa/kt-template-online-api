import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * 按当前运行态读取问候文本。
   * @returns 当前状态对应的问候文本，取值为 `'Hello World!'`。
   */
  getHello(): string {
    return 'Hello World!';
  }
}
