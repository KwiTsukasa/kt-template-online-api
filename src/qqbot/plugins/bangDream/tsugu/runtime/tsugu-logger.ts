import { Logger } from '@nestjs/common';

const tsuguLogger = new Logger('BangDreamTsugu');

export function logger(type: string, message: unknown) {
  tsuguLogger.log(`[${type}] ${String(message)}`);
}
