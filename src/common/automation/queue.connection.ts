import { requireExecutionState } from '@/common/automation/validation';
import type { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';

/**
 * 复用现有任务 Redis 配置供自动化基础队列使用，缺少主机时拒绝猜测远端。
 * @param config - 当前应用已加载的配置。
 * @returns 队列连接和隔离前缀。
 * @throws 主机缺失、端口或数据库编号非法时拒绝启动。
 */
export function automationQueueConnection(config: ConfigService): {
  connection: ConnectionOptions;
  prefix: string;
} {
  const read = (keys: string[], fallback = '') => {
    for (const key of keys) {
      const value = config.get(key);
      if (value !== undefined && value !== null && String(value).trim())
        return String(value).trim();
    }
    return fallback;
  };
  const host = read([
    'TASK_QUEUE_REDIS_HOST',
    'PLUGIN_TASK_QUEUE_REDIS_HOST',
    'PLUGIN_QUEUE_REDIS_HOST',
    'REDIS_HOST',
  ]);
  const port = Number(
    read(
      [
        'TASK_QUEUE_REDIS_PORT',
        'PLUGIN_TASK_QUEUE_REDIS_PORT',
        'PLUGIN_QUEUE_REDIS_PORT',
        'REDIS_PORT',
      ],
      '6379',
    ),
  );
  const db = Number(
    read(
      [
        'TASK_QUEUE_REDIS_DB',
        'PLUGIN_TASK_QUEUE_REDIS_DB',
        'PLUGIN_QUEUE_REDIS_DB',
        'REDIS_DB',
      ],
      '0',
    ),
  );
  const password = read([
    'TASK_QUEUE_REDIS_PASSWORD',
    'PLUGIN_TASK_QUEUE_REDIS_PASSWORD',
    'PLUGIN_QUEUE_REDIS_PASSWORD',
    'REDIS_PASSWORD',
  ]);
  const validPort = Number.isSafeInteger(port) && port >= 1 && port <= 65535;
  const validDatabase = Number.isSafeInteger(db) && db >= 0;
  requireExecutionState(host, '自动化队列缺少 Redis 主机');
  requireExecutionState(validPort, '自动化队列 Redis 端口不合法');
  requireExecutionState(validDatabase, '自动化队列 Redis 数据库编号不合法');
  return {
    connection: { host, port, db, password: password || undefined },
    prefix: read(
      [
        'TASK_QUEUE_REDIS_PREFIX',
        'PLUGIN_TASK_QUEUE_REDIS_PREFIX',
        'PLUGIN_TASK_QUEUE_PREFIX',
        'PLUGIN_QUEUE_REDIS_PREFIX',
      ],
      'kt:automation',
    ),
  };
}
