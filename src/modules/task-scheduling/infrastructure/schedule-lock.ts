import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { withDatabaseLock } from '@/common/locks/database-lock';

@Injectable()
export class ScheduleLock {
  constructor(private readonly database: DataSource) {}

  /**
   * 声明计划级资源与立即竞争策略，由全局锁能力串行化启停和派发。
   * @param scheduleId - 当前计划身份。
   * @param action - 仅使用当前连接执行本模块写入的操作。
   * @returns 操作结果；已有其他持有者时返回空值供调用方稍后重试。
   */
  async run<T>(
    scheduleId: string,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T | undefined> {
    const result = await withDatabaseLock(
      this.database,
      `kt:schedule:${scheduleId}`,
      0,
      action,
    );
    if (result.acquired) return result.value;
    return undefined;
  }
}
