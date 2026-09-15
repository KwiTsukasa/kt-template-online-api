import { isDeepStrictEqual } from 'node:util';
import type { Queue } from 'bullmq';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { readMigrationCheckpoint, saveMigrationCheckpoint, readLegacyQueueSnapshot, snapshotContent, type LegacyQueueSnapshot } from './queue-snapshot';
import { readManagedMenus } from './menus';

/**
 * 在新 API 已停止且还没有新运行时恢复旧菜单及队列；保留所有新表和封存证据，不覆盖已使用的系统。
 * @param connection - 已明确目标且绑定大整数安全模式的连接。
 * @param queues - 与切换快照身份一致的两个旧队列。
 * @returns 恢复的菜单和队列数量以及保留证据的位置。
 * @throws 新执行已被接收、菜单被修改、快照漂移或锁冲突时拒绝自动回滚。
 */
export async function rollbackAutomationBeforeExecution(connection: Connection, queues: Queue[]) {
  const lock = 'kt:automation-v2-cutover';
  const [locks] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,10) acquired', [lock]);
  if (Number(locks[0]?.acquired) !== 1) throw new Error('无法取得自动化回滚锁');
  try {
    const identity = await readMigrationCheckpoint<{ databaseName: string; serverUuid: string }>(connection, 'cutover:identity');
    const [currentIdentity] = await connection.query<RowDataPacket[]>('SELECT DATABASE() databaseName,@@server_uuid serverUuid');
    if (!identity || !isDeepStrictEqual(identity.payload, { databaseName: String(currentIdentity[0].databaseName), serverUuid: String(currentIdentity[0].serverUuid) }))
      throw new Error('回滚快照不属于当前数据库身份');
    const [accepted] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) count FROM automation_task_run run
      WHERE NOT EXISTS (SELECT 1 FROM automation_task_attempt attempt WHERE attempt.run_id=run.id AND attempt.runtime_identity IN ('legacy:plugin-task','legacy:bot-reminders'))`);
    const [workflows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) count FROM automation_workflow_run');
    const [dispatches] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) count FROM automation_schedule_dispatch');
    if (Number(accepted[0].count) || Number(workflows[0].count) || Number(dispatches[0].count))
      throw new Error('新系统已经接收执行，必须先核对发生游标和发送结果，不能自动恢复旧调度');
    const before = await readMigrationCheckpoint<{ menus: Record<string, any>[]; grants: Record<string, string>[]; managedIds: string[] }>(connection, 'menus:before');
    const after = await readMigrationCheckpoint(connection, 'menus:after');
    const restored = await readMigrationCheckpoint(connection, 'menus:restored');
    if (before && after) {
      const current = await readManagedMenus(connection, before.payload.managedIds);
      let expected = after.payload;
      if (restored) expected = restored.payload;
      if (!isDeepStrictEqual(current, expected)) throw new Error('菜单或角色关联在切换后已修改，拒绝自动覆盖');
    } else if (before || after) throw new Error('菜单前后快照不完整');
    const snapshots: { queue: Queue; snapshot: LegacyQueueSnapshot }[] = [];
    for (const queue of queues) {
      const existing = await readMigrationCheckpoint<LegacyQueueSnapshot>(connection, 'queue:' + queue.name);
      if (!existing) continue;
      if (existing.payload.prefix !== queue.opts.prefix || existing.payload.name !== queue.name)
        throw new Error('旧队列与回滚快照身份不一致');
      if (snapshotContent(await readLegacyQueueSnapshot(queue)) !== snapshotContent(existing.payload))
        throw new Error('旧队列在封存后发生变化，拒绝自动恢复');
      if (existing.state === 'paused' && !(await queue.isPaused()))
        throw new Error('旧队列被其他操作提前恢复');
      snapshots.push({ queue, snapshot: existing.payload });
    }
    await connection.beginTransaction();
    try {
      if (before && !restored) {
        const managedPlaceholders = before.payload.managedIds.map(() => '?').join(',');
        await connection.query(`DELETE FROM admin_role_menu WHERE menu_id IN (${managedPlaceholders})`, before.payload.managedIds);
        const originalIds = new Set(before.payload.menus.map(row => String(row.id)));
        const addedIds = before.payload.managedIds.filter(id => !originalIds.has(id));
        if (addedIds.length) {
          const placeholders = addedIds.map(() => '?').join(',');
          await connection.query(`DELETE FROM admin_role_menu WHERE menu_id IN (${placeholders})`, addedIds);
          await connection.query(`DELETE FROM admin_menu WHERE id IN (${placeholders})`, addedIds);
        }
        for (const row of before.payload.menus) {
          const columns = Object.keys(row).filter(column => column !== 'id');
          if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error('菜单快照字段不合法');
          await connection.query('UPDATE admin_menu SET ' + columns.map(column => '`' + column + '`=?').join(',') + ' WHERE id=?', [...columns.map(column => row[column]), String(row.id)]);
        }
        for (const grant of before.payload.grants)
          await connection.query('INSERT INTO admin_role_menu(role_id,menu_id) VALUES(?,?)', [grant.role_id, grant.menu_id]);
        await saveMigrationCheckpoint(connection, 'menus:restored', await readManagedMenus(connection, before.payload.managedIds), 'sealed');
      }
      await connection.query("UPDATE _kt_automation_v2_checkpoint SET state='rolled-back' WHERE checkpoint_key='cutover:complete'");
      await connection.commit();
    } catch (error) {
      await connection.rollback(); throw error;
    }
    for (const { queue, snapshot } of snapshots) {
      await connection.query("UPDATE _kt_automation_v2_checkpoint SET state='resuming' WHERE checkpoint_key=?", ['queue:' + queue.name]);
      if (!snapshot.wasPaused) await queue.resume();
      if ((await queue.isPaused()) !== snapshot.wasPaused) throw new Error('旧队列恢复状态校验失败');
      await connection.query("UPDATE _kt_automation_v2_checkpoint SET state='rolled-back' WHERE checkpoint_key=?", ['queue:' + queue.name]);
    }
    return { status: 'rolled-back-before-execution', restoredMenus: before?.payload.menus.length || 0, oldQueues: snapshots.length, preserved: '所有新表、旧表和 _kt_automation_v2_checkpoint 快照均保留；旧 API 启动前重新检查队列状态' };
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
  }
}
