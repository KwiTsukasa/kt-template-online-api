import { resolve } from 'node:path';
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from 'mysql2/promise';
import type { Queue } from 'bullmq';
import {
  ensureAutomationSchema,
  preserveLegacyTaskTable,
  readAutomationColumns,
} from './automation-migration/schema';
import {
  ensureMigrationCheckpoint,
  openLegacyQueue,
  readMigrationCheckpoint,
  saveMigrationCheckpoint,
  snapshotAndPauseQueue,
  type LegacyQueueSnapshot,
} from './automation-migration/queue-snapshot';
import { migrateLegacyPluginTasks } from './automation-migration/legacy-tasks';
import { migrateLegacyReminders } from './automation-migration/legacy-reminders';
import { migrateAutomationMenus } from './automation-migration/menus';
import {
  migrateAutomationNavigation,
  restoreAutomationNavigation,
} from './automation-migration/menus-v2';
import { rollbackAutomationBeforeExecution } from './automation-migration/rollback';

const LOCK = 'kt:automation-v2-cutover';
export type AutomationMigrationOptions = {
  sqlRoot: string;
  queues: { pluginTasks: Queue; reminders: Queue };
};

/**
 * 核对旧插件队列只剩已归档结果或可转换的重复计划，未知手动待执行请求不会被丢弃。
 * @param snapshot - 已封存且暂停的旧插件任务队列。
 * @throws 存在手动待执行请求、未知状态或活动任务时要求先处理原请求。
 */
function verifyPluginQueue(snapshot: LegacyQueueSnapshot): void {
  for (const job of snapshot.jobs) {
    if (job.state === 'completed' || job.state === 'failed') continue;
    if (
      !['delayed', 'waiting', 'paused'].includes(job.state) ||
      !job.id.startsWith('repeat:plugin-task:') ||
      !job.data.taskId
    )
      throw new Error(`旧插件队列存在不能自动转换的待执行请求：${job.id}`);
  }
}

/**
 * 在旧 API 已停止的独占窗口执行结构、快照、资源、历史和菜单迁移，旧队列保留并暂停以供回滚。
 * @param connection - 绑定明确业务库且保持大整数为字符串的连接。
 * @param options - 当前发布 SQL 和两个明确的旧队列客户端。
 * @returns 目标库身份、结构与迁移计数；不输出凭据、正文或原始任务载荷。
 * @throws 锁、身份、原始数据、队列或菜单校验失败时阻止新应用启动。
 */
export async function migrateTaskAutomation(
  connection: Connection,
  options: AutomationMigrationOptions,
) {
  let locked = false;
  try {
    const [locks] = await connection.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, 10) acquired',
      [LOCK],
    );
    locked = Number(locks[0]?.acquired) === 1;
    if (!locked) throw new Error('无法取得自动化切换锁');
    const [identities] = await connection.query<RowDataPacket[]>(
      'SELECT DATABASE() databaseName,@@server_uuid serverUuid',
    );
    const identity = {
      databaseName: String(identities[0].databaseName),
      serverUuid: String(identities[0].serverUuid),
    };
    const tables = await ensureAutomationSchema(connection, options.sqlRoot);
    await ensureMigrationCheckpoint(connection);
    const previous = await readMigrationCheckpoint<Record<string, any>>(
      connection,
      'cutover:complete',
    );
    if (previous && previous.state !== 'complete')
      throw new Error('此切换已回滚，需重新核对旧系统增量后制定再次切换');
    if (
      previous &&
      (previous.payload.databaseName !== identity.databaseName ||
        previous.payload.serverUuid !== identity.serverUuid)
    )
      throw new Error('自动化迁移检查点属于其他数据库身份');
    await saveMigrationCheckpoint(
      connection,
      'cutover:identity',
      identity,
      'sealed',
    );
    const backups: string[] = [];
    for (const table of ['plugin_task', 'plugin_task_run']) {
      if ((await readAutomationColumns(connection, table)).size)
        backups.push(await preserveLegacyTaskTable(connection, table));
    }
    const pluginQueue = await snapshotAndPauseQueue(
      connection,
      options.queues.pluginTasks,
    );
    const reminderQueue = await snapshotAndPauseQueue(
      connection,
      options.queues.reminders,
    );
    verifyPluginQueue(pluginQueue);
    if (previous) {
      await connection.beginTransaction();
      try {
        const menus = await migrateAutomationMenus(connection, options.sqlRoot);
        await connection.commit();
        return {
          ...previous.payload,
          moduleTables: tables.length,
          navigation: menus.navigation,
          menus,
          status: 'ready',
          repeated: true,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    await connection.beginTransaction();
    try {
      let result: Record<string, unknown>;
      if (previous) result = previous.payload;
      else {
        const tasks = await migrateLegacyPluginTasks(
          connection,
          pluginQueue.wasPaused,
        );
        const reminders = await migrateLegacyReminders(
          connection,
          reminderQueue,
        );
        result = {
          ...identity,
          moduleTables: tables.length,
          tasks,
          reminders,
          backups,
          oldQueues: 'paused-and-preserved',
        };
      }
      const menus = await migrateAutomationMenus(connection, options.sqlRoot);
      if (!previous)
        await saveMigrationCheckpoint(
          connection,
          'cutover:complete',
          { ...result, menus },
          'complete',
        );
      await connection.commit();
      return { ...result, menus, status: 'ready', repeated: Boolean(previous) };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [LOCK]);
  }
}

/**
 * 拒绝缺失的部署参数，避免迁移或回滚误用默认数据库与队列。
 * @param name - 必须明确声明的环境变量。
 * @returns 非空原始配置。
 * @throws 参数缺失时停止启动。
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`自动化迁移缺少 ${name}`);
  return value;
}

/**
 * 仅供 Recreate 初始化容器运行正式切换，旧 API 停止由部署控制器保证，失败保持旧数据和队列快照。
 * @throws 未声明单拥有者窗口、数据库连接或迁移失败时终止后续应用启动。
 */
async function main(): Promise<void> {
  if (process.env.AUTOMATION_SINGLE_OWNER_CUTOVER !== '1')
    throw new Error(
      '自动化迁移必须在旧 API 已停止的 Recreate 单拥有者窗口执行',
    );
  const port = Number(required('DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('数据库端口不合法');
  const connection = await createConnection({
    host: required('DB_HOST'),
    port,
    database: required('DB_DATABASE'),
    user: required('DB_USERNAME'),
    password: required('DB_PASSWORD'),
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 10000,
  });
  const queues: Queue[] = [];
  try {
    if (
      process.argv.includes('--navigation-only') ||
      process.argv.includes('--rollback-navigation')
    ) {
      const [locks] = await connection.query<RowDataPacket[]>(
        'SELECT GET_LOCK(?,10) acquired',
        [LOCK],
      );
      if (Number(locks[0]?.acquired) !== 1)
        throw new Error('无法取得导航迁移锁');
      try {
        await ensureMigrationCheckpoint(connection);
        await connection.beginTransaction();
        try {
          let navigation: unknown;
          if (process.argv.includes('--rollback-navigation'))
            navigation = await restoreAutomationNavigation(connection);
          else navigation = await migrateAutomationNavigation(connection);
          await connection.commit();
          process.stdout.write(JSON.stringify({ navigation }) + '\n');
          return;
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      } finally {
        await connection.query('SELECT RELEASE_LOCK(?)', [LOCK]);
      }
    }
    const pluginTasks = openLegacyQueue('plugin-task');
    queues.push(pluginTasks);
    const reminders = openLegacyQueue('bot-reminders');
    queues.push(reminders);
    let result: unknown;
    if (process.argv.includes('--rollback-before-execution'))
      result = await rollbackAutomationBeforeExecution(connection, queues);
    else
      result = await migrateTaskAutomation(connection, {
        sqlRoot: resolve(__dirname, '../../sql'),
        queues: { pluginTasks, reminders },
      });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    try {
      await Promise.all(queues.map((queue) => queue.close()));
    } finally {
      await connection.end();
    }
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    let message = '未知迁移错误';
    if (error instanceof Error) message = error.message;
    process.stderr.write(`自动化迁移失败：${message}\n`);
    process.exitCode = 1;
  });
}
