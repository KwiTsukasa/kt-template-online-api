import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createSnowflakeId } from '../../common/snowflake/snowflake-id';
import type { BotReminderData } from '../../modules/bot-adapter/core/contract/message/bot-reminder.port';
import type { AtomicTaskDefinition } from '../../modules/task-execution/contract/task-definition.types';
import { BOT_REMINDER_HANDLER } from '../../integrations/automation/bot-reminder.defaults';
import { migrateResourceSet, persistMigratedDefinition } from './resources';
import type { LegacyJobSnapshot, LegacyQueueSnapshot } from './queue-snapshot';

/**
 * 从旧提醒载荷还原原始身份并核对最小投递数据，损坏归属或交互标签不会借迁移绕过校验。
 * @param value - 旧队列或调度器模板中的持久数据。
 * @returns 对外提醒身份及保留首次计划时间的领域数据。
 * @throws 归属、正文、时间或成员标识不符合旧合同与新领域约束时停止迁移。
 */
function reminderPayload(value: Record<string, any>) {
  const data = JSON.parse(JSON.stringify(value)) as BotReminderData;
  const message = data.message;
  if (!message || !message.selfId || !message.targetId || !message.userId || !data.sourcePluginKey)
    throw new Error('旧提醒缺少发送身份或来源插件');
  const owner = createHash('sha256').update(JSON.stringify([message.selfId, message.messageType, message.targetId, message.userId])).digest('hex');
  const id = String(message.messageId || '');
  if (owner !== data.owner || !id.startsWith(owner + '-') || id.length > 191)
    throw new Error('旧提醒归属与消息身份不一致');
  if (data.variants && (!Array.isArray(data.variants) || data.variants.length > 24 || data.variants.length === 1))
    throw new Error('旧提醒轮换文案数量不合法');
  for (const text of [data.text, ...(data.variants || [])]) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1200 || /\[CQ:|<(?:@|qqbot-)/iu.test(text))
      throw new Error('旧提醒包含不合法正文或文案');
  }
  if (!Number.isFinite(Date.parse(data.dueAt))) throw new Error('旧提醒首次发生时间不合法');
  if (data.platformId !== undefined && (message.messageType === 'private' || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.platformId)))
    throw new Error('旧提醒持久成员身份不合法');
  // 迁移同样只保存后续投递所需目标，不传播旧被动回复凭据和原始附件。
  data.message = {
    selfId: message.selfId, connectionMode: message.connectionMode,
    messageType: message.messageType, targetId: message.targetId, userId: message.userId,
    channelId: message.channelId, guildId: message.guildId, messageId: id,
    messageText: data.text, rawMessage: data.text, rawEvent: {}, eventTime: message.eventTime,
  };
  return { id, data: JSON.parse(JSON.stringify(data)) as BotReminderData };
}

/**
 * 保存提醒原有公开身份与业务载荷；重入不覆盖新系统已经记录的取消或发送结果。
 * @param connection - 外层迁移事务连接。
 * @param id - 保持不变的用户提醒身份。
 * @param data - 经过归属和内容校验的最小业务数据。
 * @param status - 快照对应的已安排或历史终态。
 * @param scheduleId - 活动提醒对应的新计划，历史终态为空。
 * @param error - 旧任务保存的实际错误信息。
 * @throws 同一提醒身份已绑定不同载荷时拒绝覆盖。
 */
async function persistReminder(connection: Connection, id: string, data: BotReminderData, status: string, scheduleId: string | null, error: string | null): Promise<void> {
  const [existing] = await connection.query<RowDataPacket[]>('SELECT data FROM bot_reminder WHERE id=? FOR UPDATE', [id]);
  if (existing.length) {
    let previous = existing[0].data;
    if (typeof previous === 'string') previous = JSON.parse(previous);
    if (!isDeepStrictEqual(previous, data)) throw new Error('提醒身份已被不同业务数据占用');
    return;
  }
  await connection.query('INSERT INTO bot_reminder(id,owner,data,status,schedule_id,sync_pending,last_error) VALUES (?,?,?,?,?,0,?)', [id, data.owner, JSON.stringify(data), status, scheduleId, error]);
}

/**
 * 将旧队列已完成投递映射到执行中心，原队列任务 ID 经稳定执行键关联且完整载荷仍保留在快照。
 * @param connection - 迁移事务连接。
 * @param taskId - 共用的 Bot 投递原子任务身份。
 * @param job - 旧队列中的已完成或失败记录。
 * @param reminderId - 原有用户提醒身份。
 * @param data - 首次计划时间及最小投递数据。
 * @throws 同一稳定历史执行键已关联其他原子任务时拒绝归档。
 */
async function persistReminderHistory(connection: Connection, taskId: string, job: LegacyJobSnapshot, reminderId: string, data: BotReminderData): Promise<void> {
  if (job.state !== 'completed' && job.state !== 'failed') return;
  const executionKey = createHash('sha256').update('legacy:bot-reminders:' + job.id).digest('hex');
  const [existing] = await connection.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) id,CAST(task_id AS CHAR) task_id FROM automation_task_run WHERE execution_key=?', [executionKey]);
  if (existing.length) {
    if (String(existing[0].task_id) !== taskId) throw new Error('提醒历史执行键已被其他任务占用');
    return;
  }
  const id = createSnowflakeId();
  let status = 'failed';
  if (job.state === 'completed') status = 'succeeded';
  let occurrence = new Date(data.dueAt);
  if (Number.isFinite(Number(job.opts.prevMillis))) occurrence = new Date(Number(job.opts.prevMillis));
  const startedAt = new Date(job.raw?.processedOn || job.timestamp);
  const finishedAt = new Date(job.finishedOn || job.timestamp);
  await connection.query(`INSERT INTO automation_task_run
    (id,task_id,task_version,execution_key,request_hash,parent_run_id,node_id,status,input_values,output_values,attempt_count,cancel_requested,requires_review,error_message,deadline_at,next_attempt_at,finished_at,create_time)
    VALUES (?,?,1,?,?,NULL,NULL,?,?,NULL,1,0,0,?,?,?,?,?)`, [id, taskId, executionKey, executionKey, status, JSON.stringify({ reminderId, occurredAt: occurrence.toISOString() }), job.failedReason || null, finishedAt, finishedAt, finishedAt, startedAt]);
  await connection.query(`INSERT INTO automation_task_attempt(id,run_id,attempt_no,status,runtime_identity,handler_key,handler_version,error_message,started_at,finished_at)
    VALUES (?,?,1,?,'legacy:bot-reminders',?,1,?,?,?)`, [id, id, status, BOT_REMINDER_HANDLER.key, job.failedReason || null, startedAt, finishedAt]);
}

/**
 * 把封存的旧提醒队列转换为独立业务记录、触发器及计划，保留每日游标、用户身份和历史。
 * @param connection - 外层迁移事务连接。
 * @param snapshot - 已暂停旧队列且摘要验证通过的原始快照。
 * @returns 活动提醒、历史投递和领域记录计数，不输出正文或发送目标。
 * @throws 旧时区、任务状态或身份不受支持时停止，不跳过不明提醒。
 */
export async function migrateLegacyReminders(connection: Connection, snapshot: LegacyQueueSnapshot) {
  if (snapshot.name !== 'bot-reminders') throw new Error('提醒迁移收到其他队列快照');
  if (!snapshot.jobs.length && !snapshot.schedulers.length) return { active: 0, history: 0, records: 0 };
  const handler = BOT_REMINDER_HANDLER;
  const task: AtomicTaskDefinition = { schemaVersion: 1, handler: { key: handler.key, version: handler.version },
    contract: { inputSchema: handler.inputSchema, outputSchema: handler.outputSchema, ownerKind: handler.ownerKind, idempotent: handler.idempotent },
    timeoutMs: handler.timeoutMs, maxAttempts: 1, retryBackoffMs: 5000,
  };
  const resource = await persistMigratedDefinition(connection, 'automation_task', { sourceKey: 'system:bot.reminder.deliver:task', name: handler.name, description: 'Bot 领域保存发送内容；此计划仅引用提醒身份和发生时间', definition: task });
  const active = new Set<string>();
  const records = new Set<string>();
  for (const scheduler of snapshot.schedulers) {
    const { id, data } = reminderPayload(scheduler.template?.data || {});
    if (scheduler.key !== id || scheduler.pattern !== data.repeat || scheduler.tz !== 'Asia/Shanghai' || !Number.isFinite(scheduler.next))
      throw new Error('旧每日提醒的调度器与业务载荷不一致');
    const sourceKey = 'bot:reminder:' + createHash('sha256').update(id).digest('hex');
    const plan = await migrateResourceSet(connection, { sourceKey, taskSourceKey: 'system:bot.reminder.deliver:task', name: handler.name, description: '迁移的 Bot 提醒；发送数据保存在 Bot 领域', task,
      trigger: { schemaVersion: 1, trigger: { type: 'cron', expression: data.repeat!, timezone: 'Asia/Shanghai' } },
      input: { reminderId: { source: 'literal', value: id }, occurredAt: { source: 'occurrence', field: 'occurredAt' } },
      enabled: !snapshot.wasPaused, nextAt: new Date(scheduler.next),
    });
    await persistReminder(connection, id, data, 'scheduled', plan.scheduleId, null);
    active.add(id); records.add(id);
  }
  let history = 0;
  for (const job of snapshot.jobs) {
    const { id, data } = reminderPayload(job.data);
    if (!records.has(id)) {
      let scheduleId: string | null = null;
      let status = 'cancelled';
      if (!data.repeat) {
        if (job.id !== id) throw new Error('旧一次性提醒的任务身份不一致');
        if (job.state === 'completed') status = 'succeeded';
        else if (job.state === 'failed') status = 'failed';
        else if (['delayed', 'waiting', 'paused'].includes(job.state)) {
          const sourceKey = 'bot:reminder:' + createHash('sha256').update(id).digest('hex');
          const plan = await migrateResourceSet(connection, { sourceKey, taskSourceKey: 'system:bot.reminder.deliver:task', name: handler.name, description: '迁移的 Bot 一次性提醒', task,
            trigger: { schemaVersion: 1, trigger: { type: 'once', at: data.dueAt } },
            input: { reminderId: { source: 'literal', value: id }, occurredAt: { source: 'occurrence', field: 'occurredAt' } }, enabled: !snapshot.wasPaused, nextAt: new Date(data.dueAt),
          });
          scheduleId = plan.scheduleId; status = 'scheduled'; active.add(id);
        } else throw new Error('旧提醒包含未支持的任务状态');
      }
      await persistReminder(connection, id, data, status, scheduleId, job.failedReason || null);
      records.add(id);
    }
    if (job.state === 'completed' || job.state === 'failed') {
      await persistReminderHistory(connection, resource.id, job, id, data); history++;
    }
  }
  return { active: active.size, history, records: records.size };
}
