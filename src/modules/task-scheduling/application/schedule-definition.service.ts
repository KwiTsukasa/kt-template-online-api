import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DefinitionProvision } from '@/common/automation/definition-provision.port';
import {
  DefinitionRepository,
  validateDefinitionInput,
} from '@/common/automation/definition.repository';
import {
  publishedReference,
  type PublishedReference,
} from '@/common/automation/definition.types';
import {
  TRIGGER_ENGINE,
  type TriggerEnginePort,
} from '@/modules/trigger-engine/contract/trigger.types';
import {
  RULE_ENGINE,
  type RuleEnginePort,
} from '@/modules/rule-engine/contract/rule.types';
import {
  TASK_EXECUTION,
  type TaskExecutionPort,
} from '@/modules/task-execution/contract/task-execution.port';
import {
  WORKFLOW_EXECUTION,
  type WorkflowExecutionPort,
} from '@/modules/workflow-engine/contract/workflow.types';
import type { ScheduleDefinition } from '../contract/schedule.types';
import {
  normalizeScheduleDefinition,
  validateScheduleBindings,
} from '../domain/schedule-definition.policy';
import {
  ScheduleDraft,
  ScheduleRevision,
} from '../infrastructure/persistence/schedule-plan.entities';

@Injectable()
export class ScheduleDefinitionService {
  readonly definitions: DefinitionRepository<ScheduleDefinition>;
  constructor(
    database: DataSource,
    @Inject(TRIGGER_ENGINE) readonly triggers: TriggerEnginePort,
    @Optional() @Inject(RULE_ENGINE) readonly rules?: RuleEnginePort,
    @Optional() @Inject(TASK_EXECUTION) readonly tasks?: TaskExecutionPort,
    @Optional()
    @Inject(WORKFLOW_EXECUTION)
    readonly workflows?: WorkflowExecutionPort,
  ) {
    this.definitions = new DefinitionRepository(
      database,
      ScheduleDraft,
      ScheduleRevision,
      normalizeScheduleDefinition,
    );
  }

  /**
   * 由资源所属模块建立来源声明的首个发布版本，重启或重复同步不覆盖管理员编辑。
   * @param input - 集成声明的稳定来源键、默认配置和可选迁移身份。
   * @returns 已保留或新建的资源以及本次创建标志。
   */
  provision(input: DefinitionProvision<ScheduleDefinition>) {
    return this.definitions.provision(input, async (definition) => {
      await this.checkForPublish(definition);
    });
  }

  /**
   * 通过各模块公开契约核对固定引用和映射，不读取外部实体或服务实现。
   * @param definition - 当前计划草稿。
   * @returns 触发载荷、目标输入和可选规则事实，供计划编辑器展示映射控件。
   * @throws 依赖未选、目标不可用或映射不合法时拒绝发布。
   */
  async checkForPublish(definition: ScheduleDefinition) {
    if (!definition.triggerRef || !definition.target)
      throw new BadRequestException('必须选择触发器和执行目标的固定发布版本');
    const trigger = await this.triggers.resolve(definition.triggerRef);
    let eventSchema = {
      fields: [],
    } as import('@/common/automation/data-schema').DataSchema;
    if (trigger.trigger.type === 'event')
      eventSchema = trigger.trigger.payloadSchema;
    let inputSchema: import('@/common/automation/data-schema').DataSchema;
    if (definition.target.type === 'task') {
      if (!this.tasks) throw new BadRequestException('原子任务执行模块未装配');
      const task = await this.tasks.resolve(definition.target.reference);
      if (!task.available)
        throw new BadRequestException('原子任务处理器当前不可用');
      inputSchema = task.inputSchema;
    } else {
      if (!this.workflows)
        throw new BadRequestException('工作流执行模块未装配');
      inputSchema = (await this.workflows.resolve(definition.target.reference))
        .graph.inputSchema;
    }
    validateDefinitionInput(() =>
      validateScheduleBindings(definition.input, inputSchema, eventSchema),
    );
    if (definition.admission) {
      if (!this.rules) throw new BadRequestException('规则引擎未装配');
      const rule = await this.rules.resolve(definition.admission.ruleRef);
      if (
        rule.mode === 'condition' &&
        typeof definition.admission.expected !== 'boolean'
      )
        throw new BadRequestException('条件规则的准入匹配值必须是布尔值');
      validateDefinitionInput(() =>
        validateScheduleBindings(
          definition.admission!.facts,
          rule.factSchema,
          eventSchema,
        ),
      );
    }
    return { eventSchema, inputSchema };
  }

  /**
   * 只读取已经发布的计划版本，运行启停状态不会覆盖草稿或发布记录。
   * @param reference - 计划资源及固定版本。
   * @returns 不可变的计划定义。
   */
  resolve(reference: PublishedReference) {
    return this.definitions.published(
      validateDefinitionInput(() => publishedReference(reference)),
    );
  }
}
