import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createSnowflakeId } from '../../common/snowflake/snowflake-id';
import { defaultActionWorkflow } from '../../integrations/automation/default-action-workflow';
import type { AtomicTaskDefinition } from '../../modules/task-execution/contract/task-definition.types';
import type { TriggerDefinition } from '../../modules/trigger-engine/contract/trigger.types';
import type {
  ScheduleBinding,
  ScheduleDefinition,
} from '../../modules/task-scheduling/contract/schedule.types';
import { normalizeAtomicTaskDefinition } from '../../modules/task-execution/domain/task-definition.policy';
import { normalizeTriggerDefinition } from '../../modules/trigger-engine/domain/trigger.policy';
import { nextTriggerAt } from '../../modules/trigger-engine/domain/trigger.policy';

export type MigratedResource = {
  id: string;
  version: number;
  created: boolean;
};

/**
 * 在当前迁移事务内插入来源唯一的发布资源；已有资源只核对身份，保留管理员后续修改。
 * @param connection - 外层持有事务和迁移锁的连接。
 * @param table - 动作、标准工作流、触发器或调度计划的白名单表名。
 * @param input - 迁移来源、名称及已验证的配置，可指定旧任务身份。
 * @returns 稳定资源身份和其首个迁移版本。
 * @throws 来源复用为其他旧身份或发布版本丢失时拒绝覆盖。
 */
export async function persistMigratedDefinition(
  connection: Connection,
  table:
    | 'automation_task'
    | 'automation_workflow'
    | 'automation_trigger'
    | 'automation_schedule',
  input: {
    sourceKey: string;
    name: string;
    description: string;
    definition: unknown;
    preferredId?: string;
  },
): Promise<MigratedResource> {
  const [existing] = await connection.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id FROM \`${table}\` WHERE source_key=? FOR UPDATE`,
    [input.sourceKey],
  );
  if (existing.length) {
    const id = String(existing[0].id);
    if (input.preferredId && input.preferredId !== id)
      throw new Error('迁移来源已绑定其他任务身份');
    const [versions] = await connection.query<RowDataPacket[]>(
      `SELECT version FROM \`${table}_revision\` WHERE definition_id=? AND version=1`,
      [id],
    );
    if (versions.length !== 1) throw new Error('迁移资源的首个发布版本缺失');
    return { id, version: 1, created: false };
  }
  const id = input.preferredId || createSnowflakeId();
  const definition = JSON.stringify(input.definition);
  await connection.query(
    `INSERT INTO \`${table}\` (id,source_key,name,description,revision,published_version,definition) VALUES (?,?,?,?,1,1,?)`,
    [id, input.sourceKey, input.name, input.description, definition],
  );
  await connection.query(
    `INSERT INTO \`${table}_revision\` (definition_id,version,name,description,definition) VALUES (?,1,?,?,?)`,
    [id, input.name, input.description, definition],
  );
  return { id, version: 1, created: true };
}

/**
 * 以已停止的旧调度快照初始化计划控制状态，保留旧启停偏好和下次发生游标。
 * @param connection - 迁移事务连接。
 * @param plan - 已持久化的计划身份。
 * @param trigger - 此计划固定引用的触发器及配置。
 * @param enabled - 旧任务实际保存的启用偏好。
 * @param nextAt - 已封存的下次发生时间，缺省时按触发定义推导。
 */
async function seedPlanControl(
  connection: Connection,
  plan: MigratedResource,
  trigger: { reference: MigratedResource; definition: TriggerDefinition },
  enabled: boolean,
  nextAt?: Date | null,
): Promise<void> {
  const [existing] = await connection.query<RowDataPacket[]>(
    'SELECT revision FROM automation_schedule_state WHERE schedule_id=? FOR UPDATE',
    [plan.id],
  );
  if (existing.length) return;
  let bindingId: string | null = null;
  if (enabled) {
    bindingId = createSnowflakeId();
    const registrationId = createSnowflakeId();
    let dueAt = nextAt;
    if (dueAt === undefined || dueAt === null) {
      dueAt = nextTriggerAt(trigger.definition.trigger);
      if (trigger.definition.trigger.type === 'once')
        dueAt = new Date(trigger.definition.trigger.at);
    }
    await connection.query(
      "INSERT INTO automation_trigger_registration (id,consumer_key,trigger_id,trigger_version,definition,status,event_key,event_version,next_at) VALUES (?,?,?,?,?,'prepared',NULL,NULL,?)",
      [
        registrationId,
        `schedule:${plan.id}:1`,
        trigger.reference.id,
        trigger.reference.version,
        JSON.stringify(trigger.definition),
        dueAt,
      ],
    );
    await connection.query(
      'INSERT INTO automation_schedule_binding (id,schedule_id,schedule_version,activation_revision,registration_id,retired) VALUES (?,?,?,1,?,0)',
      [bindingId, plan.id, plan.version, registrationId],
    );
  }
  await connection.query(
    'INSERT INTO automation_schedule_state (schedule_id,revision,enabled,active_binding_id,error_message) VALUES (?,1,?,?,NULL)',
    [plan.id, enabled, bindingId],
  );
}

/**
 * 将旧任务迁移为动作、标准工作流、触发器和计划；保留旧动作身份，计划只能经固定流程版本执行。
 * @param connection - 外层迁移事务连接。
 * @param input - 已验证的旧配置、来源身份与封存触发游标。
 * @returns 用于历史迁移和提醒回填的稳定任务及计划身份。
 */
export async function migrateResourceSet(
  connection: Connection,
  input: {
    sourceKey: string;
    taskSourceKey?: string;
    preferredTaskId?: string;
    name: string;
    description: string;
    task: AtomicTaskDefinition;
    trigger: TriggerDefinition;
    input: Record<string, ScheduleBinding>;
    enabled: boolean;
    nextAt?: Date | null;
  },
) {
  const taskDefinition = normalizeAtomicTaskDefinition(input.task);
  const triggerDefinition = normalizeTriggerDefinition(input.trigger);
  const task = await persistMigratedDefinition(connection, 'automation_task', {
    sourceKey: input.taskSourceKey || input.sourceKey + ':task',
    preferredId: input.preferredTaskId,
    name: input.name,
    description: input.description,
    definition: taskDefinition,
  });
  const trigger = await persistMigratedDefinition(
    connection,
    'automation_trigger',
    {
      sourceKey: input.sourceKey + ':trigger',
      name: input.name + ' · 触发器',
      description: input.description,
      definition: triggerDefinition,
    },
  );
  const workflow = await persistMigratedDefinition(
    connection,
    'automation_workflow',
    {
      sourceKey:
        (input.taskSourceKey || input.sourceKey + ':task') + ':workflow',
      name: input.name + ' · 工作流',
      description: input.description,
      definition: defaultActionWorkflow(
        { id: task.id, version: task.version },
        {
          name: input.name,
          inputSchema: taskDefinition.contract.inputSchema,
          outputSchema: taskDefinition.contract.outputSchema,
          timeoutMs: taskDefinition.timeoutMs,
        },
      ),
    },
  );
  const definition: ScheduleDefinition = {
    schemaVersion: 1,
    triggerRef: { id: trigger.id, version: trigger.version },
    target: {
      type: 'workflow',
      reference: { id: workflow.id, version: workflow.version },
    },
    input: input.input,
    admission: null,
    overlap: 'skip',
    taskDeadlineMs: taskDefinition.timeoutMs + 60000,
  };
  const plan = await persistMigratedDefinition(
    connection,
    'automation_schedule',
    {
      sourceKey: input.sourceKey + ':schedule',
      name: input.name + ' · 计划',
      description: input.description,
      definition,
    },
  );
  await seedPlanControl(
    connection,
    plan,
    { reference: trigger, definition: triggerDefinition },
    input.enabled,
    input.nextAt,
  );
  return {
    taskId: task.id,
    taskVersion: task.version,
    workflowId: workflow.id,
    triggerId: trigger.id,
    scheduleId: plan.id,
  };
}
