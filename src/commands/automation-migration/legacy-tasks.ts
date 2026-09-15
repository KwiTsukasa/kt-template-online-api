import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { normalizeDataSchema } from '../../common/automation/data-schema';
import { migrateResourceSet } from './resources';
import { readAutomationColumns } from './schema';

/**
 * 读取旧 JSON 字段，空值保持为空，不把损坏数据静默转换成默认配置。
 * @param value - mysql2 返回的对象、字符串或空值。
 * @returns 解析后的原始配置。
 */
function legacyJson(value: unknown): unknown {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

/**
 * 将旧任务历史映射为只读终态，保留运行 ID；原始摘要和状态仍完整保存在旧表快照。
 * @param connection - 已取得迁移锁且旧执行者已停止的事务连接。
 * @param taskId - 保持不变的旧任务身份。
 * @param handlerKey - 冻结到安装和包版本的处理器键。
 * @returns 该任务迁移后的历史数量。
 * @throws 存在未结束状态或新表同 ID 被其他运行占用时阻止迁移。
 */
async function migrateRunHistory(
  connection: Connection,
  taskId: string,
  handlerKey: string,
): Promise<number> {
  const [unknown] = await connection.query<RowDataPacket[]>(
    "SELECT CAST(id AS CHAR) id,status FROM plugin_task_run WHERE task_id=? AND status NOT IN ('success','failed','skipped') LIMIT 1",
    [taskId],
  );
  if (unknown.length)
    throw new Error(
      `旧任务存在未确认运行：${unknown[0].id} ${unknown[0].status}`,
    );
  const [collisions] = await connection.query<RowDataPacket[]>(
    "SELECT COUNT(*) count FROM plugin_task_run old JOIN automation_task_run current ON current.id=old.id WHERE old.task_id=? AND current.execution_key<>SHA2(CONCAT('legacy:plugin-task:',old.id),256)",
    [taskId],
  );
  if (Number(collisions[0].count))
    throw new Error('旧运行身份与新运行发生冲突');
  await connection.query(
    `INSERT IGNORE INTO automation_task_run
    (id,task_id,task_version,execution_key,request_hash,parent_run_id,node_id,status,input_values,output_values,attempt_count,cancel_requested,requires_review,error_message,deadline_at,next_attempt_at,finished_at,create_time)
    SELECT id,task_id,1,SHA2(CONCAT('legacy:plugin-task:',id),256),SHA2(CONCAT('legacy:plugin-task:',id),256),NULL,NULL,
      CASE status WHEN 'success' THEN 'succeeded' WHEN 'skipped' THEN 'cancelled' ELSE 'failed' END,
      JSON_OBJECT(),NULL,1,0,0,
      CASE status WHEN 'skipped' THEN CONCAT('旧任务跳过：',COALESCE(error_message,'')) ELSE error_message END,
      COALESCE(finished_at,started_at,create_time),COALESCE(finished_at,started_at,create_time),COALESCE(finished_at,started_at,create_time),create_time
    FROM plugin_task_run WHERE task_id=?`,
    [taskId],
  );
  await connection.query(
    `INSERT IGNORE INTO automation_task_attempt
    (id,run_id,attempt_no,status,runtime_identity,handler_key,handler_version,error_message,started_at,finished_at)
    SELECT old.id,old.id,1,current.status,'legacy:plugin-task',?,1,current.error_message,COALESCE(old.started_at,old.create_time),current.finished_at
    FROM plugin_task_run old JOIN automation_task_run current ON current.id=old.id WHERE old.task_id=?`,
    [handlerKey, taskId],
  );
  const [counts] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) total,
    SUM(current.id IS NULL OR attempt.id IS NULL OR current.task_id<>old.task_id) missing
    FROM plugin_task_run old LEFT JOIN automation_task_run current ON current.id=old.id
    LEFT JOIN automation_task_attempt attempt ON attempt.run_id=old.id AND attempt.attempt_no=1 WHERE old.task_id=?`,
    [taskId],
  );
  if (Number(counts[0].missing)) throw new Error('旧运行历史迁移数量不一致');
  return Number(counts[0].total);
}

/**
 * 将现网旧插件任务拆成固定执行定义、触发器和计划，保留原任务身份、周期、启停及历史。
 * @param connection - 外层迁移事务连接。
 * @param queueWasPaused - 原队列全局暂停时，新计划保持停用以保留维护意图。
 * @returns 已迁移任务及历史计数和旧新计划关联，不包含业务输入。
 * @throws 未支持的旧组合配置、缺失安装声明或历史异常时停止，避免丢失原有行为。
 */
export async function migrateLegacyPluginTasks(connection: Connection, queueWasPaused = false) {
  const columns = await readAutomationColumns(connection, 'plugin_task');
  if (!columns.size) return { tasks: 0, runs: 0, mappings: [] };
  const [orphans] = await connection.query<RowDataPacket[]>(
    'SELECT COUNT(*) count FROM plugin_task_run run LEFT JOIN plugin_task task ON task.id=run.task_id WHERE task.id IS NULL',
  );
  if (Number(orphans[0].count))
    throw new Error('旧运行存在缺失任务的历史，需先核对原始身份');
  const [rows] = await connection.query<
    RowDataPacket[]
  >(`SELECT task.*,CAST(task.id AS CHAR) legacy_id,
    CAST(installation.id AS CHAR) installation_identity,CAST(installation.plugin_id AS CHAR) plugin_identity,
    CAST(installation.version_id AS CHAR) version_identity,version.manifest_json
    FROM plugin_task task LEFT JOIN plugin_installation installation ON installation.id=task.installation_id
    LEFT JOIN plugin_version version ON version.id=installation.version_id ORDER BY task.id`);
  let runs = 0;
  const mappings: { taskId: string; scheduleId: string }[] = [];
  for (const row of rows) {
    const id = String(row.legacy_id);
    if (row.owner_kind && row.owner_kind !== 'plugin')
      throw new Error(`旧任务不是插件能力：${id}`);
    for (const name of [
      'condition_config',
      'workflow_config',
      'input_template',
    ]) {
      const value = legacyJson(row[name]);
      if (
        value !== undefined &&
        value !== null &&
        Object.keys(value as object).length
      )
        throw new Error(`旧任务包含需要独立转换的组合配置：${id}.${name}`);
    }
    if (
      !row.installation_identity ||
      !row.version_identity ||
      !row.manifest_json
    )
      throw new Error(`旧任务的安装或版本身份缺失：${id}`);
    const manifest = legacyJson(row.manifest_json) as {
      tasks?: Record<string, unknown>[];
    };
    const capability = manifest.tasks?.find(
      (task) => task.key === row.task_key,
    );
    if (!capability || capability.handlerName !== row.handler_name)
      throw new Error(`旧任务无法对应当前安装声明：${id}`);
    const inputSchema = normalizeDataSchema(
      capability.inputSchema || { fields: [] },
    );
    const outputSchema = normalizeDataSchema(
      capability.outputSchema || { fields: [] },
    );
    if (inputSchema.fields.some((field) => field.required))
      throw new Error(`旧任务缺少新能力必填输入：${id}`);
    let expression = String(row.cron_expression);
    let timezone = 'Asia/Shanghai';
    const configured = legacyJson(row.trigger_config) as
      | Record<string, unknown>
      | undefined;
    if (configured) {
      if (configured.type !== 'cron')
        throw new Error(`旧任务需要专门转换非周期触发器：${id}`);
      expression = String(configured.expression);
      timezone = String(configured.timezone || timezone);
    }
    const handlerKey =
      'plugin.' +
      createHash('sha256')
        .update(
          [row.installation_identity, row.version_identity, row.task_key].join(
            '\0',
          ),
        )
        .digest('hex');
    const timeoutMs = Number(row.timeout_ms);
    if (timeoutMs > Number(capability.timeoutMs))
      throw new Error(`旧任务期限超出当前能力声明：${id}`);
    const sourceKey = `plugin:${row.installation_identity}:${row.task_key}`;
    const resources = await migrateResourceSet(connection, {
      sourceKey,
      preferredTaskId: id,
      name: String(row.task_name),
      description: String(row.description || ''),
      task: {
        schemaVersion: 1,
        handler: { key: handlerKey, version: 1 },
        contract: {
          inputSchema,
          outputSchema,
          ownerKind: 'plugin',
          idempotent: capability.idempotent === true,
        },
        timeoutMs,
        maxAttempts: 1,
        retryBackoffMs: 5000,
      },
      trigger: {
        schemaVersion: 1,
        trigger: { type: 'cron', expression, timezone },
      },
      input: {},
      enabled: Boolean(row.enabled) && !queueWasPaused,
      nextAt: row.next_run_at || undefined,
    });
    runs += await migrateRunHistory(connection, id, handlerKey);
    mappings.push({ taskId: id, scheduleId: resources.scheduleId });
  }
  return { tasks: rows.length, runs, mappings };
}
