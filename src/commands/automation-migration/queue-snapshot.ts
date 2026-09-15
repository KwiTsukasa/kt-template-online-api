import { createHash } from 'node:crypto';
import { Queue, type JobType } from 'bullmq';
import type { Connection, RowDataPacket } from 'mysql2/promise';

export type LegacyJobSnapshot = {
  raw?: Record<string, any>;
  id: string;
  name: string;
  data: Record<string, any>;
  opts: Record<string, any>;
  timestamp: number;
  delay: number;
  finishedOn?: number;
  failedReason?: string;
  state: string;
};
export type LegacyQueueSnapshot = {
  name: string;
  prefix: string;
  wasPaused: boolean;
  schedulers: Record<string, any>[];
  jobs: LegacyJobSnapshot[];
  capturedAt: string;
};
const JOB_STATES: JobType[] = [
  'active',
  'waiting',
  'delayed',
  'paused',
  'failed',
  'completed',
  'prioritized',
  'waiting-children',
];

/**
 * 建立私有迁移检查点表，原始队列载荷和校验摘要与生产业务表隔离。
 * @param connection - 迁移连接。
 */
export async function ensureMigrationCheckpoint(
  connection: Connection,
): Promise<void> {
  await connection.query(`CREATE TABLE IF NOT EXISTS _kt_automation_v2_checkpoint (
    checkpoint_key VARCHAR(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
    payload JSON NOT NULL, sha256 VARCHAR(64) NOT NULL, state VARCHAR(32) NOT NULL,
    create_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/**
 * 对 JSON 递归排序后序列化，避免 MySQL 调整对象键顺序造成错误的快照漂移。
 * @param value - 待密封的可序列化快照。
 * @returns 键序稳定的 JSON 文本。
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}

/**
 * 读取并校验既有密封检查点，不把损坏数据当作未迁移重新生成。
 * @param connection - 迁移连接。
 * @param key - 指定检查点身份。
 * @returns 原始载荷和状态；首次运行时为空。
 * @throws 校验摘要不一致时停止迁移。
 */
export async function readMigrationCheckpoint<T>(
  connection: Connection,
  key: string,
): Promise<{ payload: T; state: string } | undefined> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT payload,sha256,state FROM _kt_automation_v2_checkpoint WHERE checkpoint_key=?',
    [key],
  );
  if (!rows.length) return undefined;
  let payload = rows[0].payload;
  if (typeof payload === 'string') payload = JSON.parse(payload);
  const hash = createHash('sha256').update(stableJson(payload)).digest('hex');
  if (hash !== rows[0].sha256) throw new Error(`迁移检查点摘要不一致：${key}`);
  return { payload, state: String(rows[0].state) };
}

/**
 * 首次保存快照及摘要，重复写同一检查点不得替换原始证据。
 * @param connection - 迁移连接。
 * @param key - 检查点身份。
 * @param payload - 待保存的实际原始快照。
 * @param state - 与快照绑定的迁移阶段。
 * @throws 已有快照与请求内容不一致时拒绝覆盖。
 */
export async function saveMigrationCheckpoint(
  connection: Connection,
  key: string,
  payload: unknown,
  state: string,
): Promise<void> {
  const body = stableJson(payload);
  const existing = await readMigrationCheckpoint(connection, key);
  if (existing) {
    if (stableJson(existing.payload) !== body)
      throw new Error(`拒绝覆盖迁移检查点：${key}`);
    return;
  }
  await connection.query(
    'INSERT INTO _kt_automation_v2_checkpoint (checkpoint_key,payload,sha256,state) VALUES (?,?,?,?)',
    [key, body, createHash('sha256').update(body).digest('hex'), state],
  );
}

/**
 * 从明确的旧队列配置构造连接；凭据只进入客户端参数，不写入快照或输出。
 * @param name - 旧 Bot 提醒或插件任务队列名。
 * @returns 连接旧队列的客户端，调用方负责关闭。
 * @throws 缺少旧连接配置时拒绝推测其他 Redis 地址。
 */
export function openLegacyQueue(name: 'bot-reminders' | 'plugin-task'): Queue {
  let prefixes = ['PLUGIN_TASK_QUEUE_REDIS_', 'PLUGIN_QUEUE_REDIS_', 'REDIS_'];
  let prefix =
    process.env.PLUGIN_TASK_QUEUE_REDIS_PREFIX ||
    process.env.PLUGIN_TASK_QUEUE_PREFIX ||
    'kt:plugin:plugin-task';
  if (name === 'bot-reminders') {
    prefixes = ['BOT_REMINDER_REDIS_', 'PLUGIN_QUEUE_REDIS_', 'REDIS_'];
    prefix = process.env.BOT_REMINDER_QUEUE_PREFIX || 'kt:bot:reminders';
  }
  const value = (field: string) => {
    for (const start of prefixes) {
      const raw = process.env[start + field];
      if (raw !== undefined && raw !== '') return raw;
    }
    return '';
  };
  const host = value('HOST');
  if (!host) throw new Error(`旧队列连接未配置：${name}`);
  return new Queue(name, {
    prefix,
    connection: {
      host,
      port: Number(value('PORT') || 6379),
      db: Number(value('DB') || 0),
      password: value('PASSWORD') || undefined,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    },
  });
}

/**
 * 保存完整旧队列快照后暂停旧入口，重入沿用封存证据；从不删除旧任务或调度器。
 * @param connection - 已停旧 API 的独占迁移连接。
 * @param queue - 明确指向旧业务队列的客户端。
 * @returns 有校验摘要保护的原始队列快照。
 * @throws 活动任务、快照过大或暂停状态被其他写入者改变时阻止切换。
 */
export async function snapshotAndPauseQueue(
  connection: Connection,
  queue: Queue,
): Promise<LegacyQueueSnapshot> {
  const key = 'queue:' + queue.name;
  const existing = await readMigrationCheckpoint<LegacyQueueSnapshot>(
    connection,
    key,
  );
  if (existing) {
    if (existing.payload.prefix !== queue.opts.prefix)
      throw new Error('旧队列前缀与封存身份不一致');
    if (existing.state === 'paused' && !(await queue.isPaused()))
      throw new Error('旧队列被其他操作恢复，不能继续自动化切换');
    const current = await readLegacyQueueSnapshot(queue);
    if (snapshotContent(existing.payload) !== snapshotContent(current))
      throw new Error('旧队列载荷或调度器在封存后发生变化，不能遗漏新增请求');
    if (existing.state !== 'paused') {
      if ((await queue.getActiveCount()) !== 0)
        throw new Error('旧队列仍有活动任务');
      await queue.pause();
      await connection.query(
        "UPDATE _kt_automation_v2_checkpoint SET state='paused' WHERE checkpoint_key=?",
        [key],
      );
    }
    return existing.payload;
  }
  const snapshot = await readLegacyQueueSnapshot(queue);
  await saveMigrationCheckpoint(connection, key, snapshot, 'captured');
  await queue.pause();
  if ((await queue.getActiveCount()) !== 0)
    throw new Error('旧队列暂停时仍有活动执行者');
  await connection.query(
    "UPDATE _kt_automation_v2_checkpoint SET state='paused' WHERE checkpoint_key=?",
    [key],
  );
  return snapshot;
}

/**
 * 对比载荷、调度器与终态，同时容许暂停操作把等待队列改为暂停队列。
 * @param snapshot - 当前或已封存的队列快照。
 * @returns 排序后可直接比较的业务内容。
 */
export function snapshotContent(snapshot: LegacyQueueSnapshot): string {
  return stableJson({
    schedulers: [...snapshot.schedulers].sort((left, right) => String(left.key).localeCompare(String(right.key))),
    jobs: snapshot.jobs.map(job => {
      let state = job.state;
      if (state === 'waiting' || state === 'paused') state = 'waiting-or-paused';
      return { ...job, state };
    }).sort((left, right) => left.id.localeCompare(right.id)),
  });
}

/**
 * 读取有数量上限的完整旧队列内容，遇到活动任务时拒绝形成可用于切换的快照。
 * @param queue - 明确的旧队列客户端。
 * @returns 尚未写入检查点的实际快照。
 * @throws 队列过大或仍有执行者时停止读取。
 */
export async function readLegacyQueueSnapshot(queue: Queue): Promise<LegacyQueueSnapshot> {
  if ((await queue.getActiveCount()) !== 0)
    throw new Error(`旧队列仍有活动任务：${queue.name}`);
  const counts = await queue.getJobCounts(...JOB_STATES);
  const total = JOB_STATES.reduce(
    (count, state) => count + Number(counts[state] || 0),
    0,
  );
  if (total > 20000)
    throw new Error('旧队列快照超过两万条，需要先制定分批归档');
  const jobs = await queue.getJobs(JOB_STATES, 0, 20000);
  const snapshot: LegacyQueueSnapshot = {
    name: queue.name,
    prefix: queue.opts.prefix!,
    wasPaused: await queue.isPaused(),
    schedulers: await queue.getJobSchedulers(0, -1),
    jobs: await Promise.all(
      jobs.map(async (job) => ({
        raw: job.toJSON(),
        id: String(job.id),
        name: job.name,
        data: job.data,
        opts: job.opts,
        timestamp: job.timestamp,
        delay: job.delay,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        state: await job.getState(),
      })),
    ),
    capturedAt: new Date().toISOString(),
  };
  if (snapshot.jobs.some((job) => job.state === 'active'))
    throw new Error('队列快照期间出现活动任务');
  return snapshot;
}
