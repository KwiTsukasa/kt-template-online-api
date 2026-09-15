import { Inject, Injectable } from '@nestjs/common';
import {
  TASK_DEFINITIONS,
  type TaskDefinitionProvisionPort,
} from '@/modules/task-execution/contract/task-provision.port';
import type { TaskHandler } from '@/modules/task-execution/contract/task-handler.port';
import {
  TRIGGER_DEFINITIONS,
  type TriggerDefinitionProvisionPort,
} from '@/modules/trigger-engine/contract/trigger-provision.port';
import type { TriggerDefinition } from '@/modules/trigger-engine/contract/trigger.types';
import {
  SCHEDULE_DEFINITIONS,
  type ScheduleDefinitionProvisionPort,
} from '@/modules/task-scheduling/contract/schedule-provision.port';
import {
  SCHEDULE_PLANS,
  type SchedulePlanPort,
  type ScheduleBinding,
} from '@/modules/task-scheduling/contract/schedule.types';

export type DefaultPlanSeed = {
  sourceKey: string;
  name: string;
  description: string;
  handler: TaskHandler;
  trigger: TriggerDefinition['trigger'];
  enabled: boolean;
  taskSourceKey?: string;
  input?: Record<string, ScheduleBinding>;
};

@Injectable()
export class DefaultPlanProvisioner {
  constructor(
    @Inject(TASK_DEFINITIONS)
    private readonly tasks: TaskDefinitionProvisionPort,
    @Inject(TRIGGER_DEFINITIONS)
    private readonly triggers: TriggerDefinitionProvisionPort,
    @Inject(SCHEDULE_DEFINITIONS)
    private readonly schedules: ScheduleDefinitionProvisionPort,
    @Inject(SCHEDULE_PLANS) private readonly control: SchedulePlanPort,
  ) {}

  /**
   * 经三个领域自己的端口建立独立默认资源；启停修订为零才应用默认启用，保留管理员停用和编辑。
   * @param seed - 业务来源身份、执行能力与初始触发建议。
   * @returns 所属模块分配的任务、触发器和计划身份。
   * @throws 资源缺少发布版本或初始依赖不合法时拒绝继续激活。
   */
  async ensure(seed: DefaultPlanSeed) {
    const handler = seed.handler;
    const task = await this.tasks.provision({
      sourceKey: seed.taskSourceKey || seed.sourceKey + ':task',
      name: seed.name,
      description: seed.description,
      definition: {
        schemaVersion: 1,
        handler: { key: handler.key, version: handler.version },
        contract: {
          inputSchema: handler.inputSchema,
          outputSchema: handler.outputSchema,
          ownerKind: handler.ownerKind,
          idempotent: handler.idempotent,
        },
        timeoutMs: handler.timeoutMs,
        maxAttempts: 1,
        retryBackoffMs: 5000,
      },
    });
    const trigger = await this.triggers.provision({
      sourceKey: seed.sourceKey + ':trigger',
      name: seed.name + ' · 触发器',
      description: seed.description,
      definition: { schemaVersion: 1, trigger: seed.trigger },
    });
    if (!task.document.publishedVersion || !trigger.document.publishedVersion)
      throw new Error('默认资源尚未发布，保留草稿等待配置');
    const schedule = await this.schedules.provision({
      sourceKey: seed.sourceKey + ':schedule',
      name: seed.name + ' · 计划',
      description: seed.description,
      definition: {
        schemaVersion: 1,
        triggerRef: {
          id: trigger.document.id,
          version: trigger.document.publishedVersion,
        },
        target: {
          type: 'task',
          reference: {
            id: task.document.id,
            version: task.document.publishedVersion,
          },
        },
        input: seed.input || {},
        admission: null,
        overlap: 'skip',
        taskDeadlineMs: handler.timeoutMs + 60000,
      },
    });
    const state = await this.control.state(schedule.document.id);
    if (state.revision === 0 && seed.enabled) {
      if (!schedule.document.publishedVersion)
        throw new Error('默认计划尚未发布');
      await this.control.enable(
        {
          id: schedule.document.id,
          version: schedule.document.publishedVersion,
        },
        0,
      );
    }
    return {
      taskId: task.document.id,
      triggerId: trigger.document.id,
      scheduleId: schedule.document.id,
    };
  }
}
