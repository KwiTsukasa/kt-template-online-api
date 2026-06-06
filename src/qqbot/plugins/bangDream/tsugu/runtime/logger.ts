import { Logger } from '@nestjs/common';

const tsuguLogger = new Logger('BangDreamTsugu');

/**
 * 在运行时配置层中处理logger。
 *
 * @param type - 数据类型或匹配类型。
 * @param message - message参数。
 */
export function logger(type: string, message: unknown) {
  tsuguLogger.log(`[${type}] ${String(message)}`);
}
