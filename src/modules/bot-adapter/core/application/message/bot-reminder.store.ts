import { Injectable } from '@nestjs/common';
import { DataSource, In, MoreThan, type EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import { withDatabaseLock } from '@/common/locks/database-lock';
import { BotReminder } from '../../infrastructure/persistence/message/bot-reminder.entity';
import type { BotReminderData } from '../../contract/message/bot-reminder.port';

@Injectable()
export class BotReminderStore {
  constructor(private readonly database: DataSource) {}

  /**
   * 在发起人锁内检查待执行额度并持久化意图，独立提醒不会因并发创建突破上限。
   * @param id - 保留对外展示及迁移兼容的提醒身份。
   * @param data - 已通过领域校验的最小投递数据。
   * @returns 已保存且等待调度确认的提醒。
   * @throws 同一发起人达到二十条待执行提醒时拒绝创建。
   */
  async create(id: string, data: BotReminderData): Promise<BotReminder> {
    return this.lock('owner:' + data.owner, async (manager) => {
      const count = await manager.countBy(BotReminder, {
        owner: data.owner,
        status: In(['pending', 'scheduled']),
      });
      if (count >= 20) throw new Error('当前会话最多保存20个待执行提醒');
      const row = manager.create(BotReminder, {
        id,
        owner: data.owner,
        data,
        status: 'pending',
        scheduleId: null,
        syncPending: true,
        lastError: null,
      });
      await manager.insert(BotReminder, row);
      return row;
    });
  }

  /**
   * 只读取当前发起人和会话的最近提醒，不通过共享队列扫描推断归属。
   * @param owner - 经消息身份哈希得到的归属键。
   * @returns 本领域持久提醒，最多二百条。
   */
  list(owner: string): Promise<BotReminder[]> {
    return this.database.getRepository(BotReminder).find({
      where: { owner },
      order: { createTime: 'DESC' },
      take: 200,
    });
  }

  /**
   * 按游标读取待同步意图，故障提醒不会永久遮住后面的创建或取消请求。
   * @param afterId - 前一批最后一条提醒身份，首批为空。
   * @returns 本批最多一百条待同步提醒身份。
   */
  async pending(afterId: string): Promise<string[]> {
    const rows = await this.database.getRepository(BotReminder).find({
      select: { id: true },
      where: { syncPending: true, id: MoreThan(afterId) },
      order: { id: 'ASC' },
      take: 100,
    });
    return rows.map((row) => row.id);
  }

  /**
   * 串行处理同一提醒的同步、取消或发送，保存的业务状态不会被旧副本覆盖。
   * @param id - 当前提醒身份。
   * @param operation - 在同一连接上使用最新记录完成领域操作。
   * @returns 领域操作的结果。
   * @throws 提醒不存在时拒绝操作。
   */
  async withReminder<T>(
    id: string,
    operation: (row: BotReminder, manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.lock('reminder:' + id, async (manager) => {
      const row = await manager.findOneBy(BotReminder, { id });
      if (!row) throw new Error('提醒不存在');
      return operation(row, manager);
    });
  }

  /**
   * 将提醒或发起人身份映射到既有资源键，由全局锁能力管理连接和互斥生命周期。
   * @param identity - 发起人或提醒的独立互斥身份。
   * @param operation - 使用锁所属连接执行的操作。
   * @returns 操作完成后的返回值。
   * @throws 十秒内仍未取得锁时拒绝本次竞争，调用方稍后可重试。
   */
  private async lock<T>(
    identity: string,
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const key =
      'kt:remind:' +
      createHash('sha256').update(identity).digest('hex').slice(0, 48);
    const result = await withDatabaseLock(this.database, key, 10, operation);
    if (!result.acquired) throw new Error('提醒正在处理，请稍后重试');
    return result.value;
  }
}
