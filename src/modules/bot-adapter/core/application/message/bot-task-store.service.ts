import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import { toBotPluginMessageEvent } from '../event/plugin-event.mapper';

/**
 * 为对话任务和工具授权读取独立 Redis 配置，默认沿用现有持久队列。
 * @param config - 应用配置入口。
 * @returns 未配置时为空，否则为持久队列的连接参数。
 */
export function botTaskConnection(config: ConfigService) {
  const read = (field: string) =>
    String(
      config.get(`BOT_TASK_REDIS_${field}`) ||
        config.get(`PLUGIN_QUEUE_REDIS_${field}`) ||
        config.get(`REDIS_${field}`) ||
        '',
    );
  if (!read('HOST')) return undefined;
  return {
    host: read('HOST'),
    port: Number(read('PORT') || 6379),
    db: Number(read('DB') || 0),
    password: read('PASSWORD') || undefined,
    connectTimeout: 5000,
  };
}

@Injectable()
export class BotTaskStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(BotTaskStoreService.name);
  readonly redis?: Redis;
  constructor(config: ConfigService) {
    const connection = botTaskConnection(config);
    if (connection) {
      this.redis = new Redis({ ...connection, maxRetriesPerRequest: 2 });
      this.redis.on('error', (error) => this.logger.error(error.message));
    }
  }
  async onModuleDestroy() {
    await this.redis?.quit();
  }

  /**
   * 从持久层读取当前任务的授权或已完成工具结果。
   * @param key - 宿主生成的任务键。
   * @returns 不存在时为空，其余为原始 JSON 数据。
   * @throws 持久存储未配置时拒绝将任务降级为内存状态。
   */
  async read(key: string): Promise<any> {
    if (!this.redis) throw new Error('Bot后台任务存储未配置');
    const raw = await this.redis.get(`kt:bot:tasks:${key}`);
    if (!raw) return undefined;
    return JSON.parse(raw);
  }

  /**
   * 保存带失效时间的工具授权或结果，写入成功后才能声明可恢复。
   * @param key - 宿主生成的任务键。
   * @param value - 可序列化的授权或结果。
   * @param seconds - 从写入开始计算的保留时长。
   * @throws 持久存储未配置时拒绝写入。
   */
  async write(key: string, value: unknown, seconds = 86400): Promise<void> {
    if (!this.redis) throw new Error('Bot后台任务存储未配置');
    await this.redis.set(
      `kt:bot:tasks:${key}`,
      JSON.stringify(value),
      'EX',
      seconds,
    );
  }

  /**
   * 持久占有一次副作用调用，进程中断后的未知结果不自动重复执行。
   * @param key - 当前任务及操作参数的哈希。
   * @returns 首次调用为真，已占有或已执行时为假。
   * @throws 持久存储未配置时拒绝获取执行权。
   */
  async reserve(key: string): Promise<boolean> {
    if (!this.redis) throw new Error('Bot后台任务存储未配置');
    return (
      (await this.redis.set(
        `kt:bot:tasks:${key}`,
        '{"status":"running"}',
        'EX',
        86400,
        'NX',
      )) === 'OK'
    );
  }

  /**
   * 保存同会话可查询的任务进度，明确区分推理完成与消息送达。
   * @param conversationKey - 宿主按账号与会话生成的哈希。
   * @param taskId - 持久任务标识。
   * @param value - 不含凭据、工具授权或图片字节的进度摘要。
   */
  async progress(
    conversationKey: string,
    taskId: string,
    value: unknown,
  ): Promise<void> {
    await this.write(`progress:${taskId}`, value, 604800);
    const key = `kt:bot:tasks:progress-index:${conversationKey}`;
    await this.redis!.zadd(key, Date.now(), taskId);
    await this.redis!.zremrangebyrank(key, 0, -101);
    await this.redis!.expire(key, 604800);
  }

  /**
   * 只读取当前账号和当前聊天的最近任务，不允许模型指定其他会话标识。
   * @param message - 工具授权绑定的真实入站消息。
   * @returns 最近二十项任务的推理、投递状态及来源消息。
   * @throws 持久存储未配置时明确报告能力不可用。
   */
  async listTasks(message: BotNormalizedMessage): Promise<unknown[]> {
    if (!this.redis) throw new Error('Bot后台任务存储未配置');
    const conversation = toBotPluginMessageEvent(message).conversationKey;
    const ids = await this.redis.zrevrange(
      `kt:bot:tasks:progress-index:${conversation}`,
      0,
      19,
    );
    const rows = await Promise.all(
      ids.map((id) => this.read(`progress:${id}`)),
    );
    return rows.filter(Boolean);
  }
}
