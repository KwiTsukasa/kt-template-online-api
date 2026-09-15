import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

@Injectable()
export class ScheduleLock {
  constructor(private readonly database: DataSource) {}

  /**
   * 以独占数据库连接串行化同一计划的启停与派发，连接关闭会由数据库释放锁。
   * @param scheduleId - 当前计划身份。
   * @param action - 仅使用当前连接执行本模块写入的操作。
   * @returns 操作结果；已有其他持有者时返回空值供调用方稍后重试。
   */
  async run<T>(
    scheduleId: string,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T | undefined> {
    const runner = this.database.createQueryRunner();
    await runner.connect();
    let acquired = false;
    const name = `kt:schedule:${scheduleId}`;
    try {
      const rows = await runner.query('SELECT GET_LOCK(?, 0) AS acquired', [
        name,
      ]);
      acquired = Number(rows[0]?.acquired) === 1;
      if (acquired) return await action(runner.manager);
      return undefined;
    } finally {
      if (acquired)
        await runner.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
      await runner.release();
    }
  }
}
