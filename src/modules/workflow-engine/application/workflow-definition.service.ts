import {
  definitionRejectionMessage,
  requireRequest,
  requireDefinition,
} from '@/common/automation/validation';
import { ruleOutputSchema } from '@/modules/rule-engine/contract/rule-output';

import {
  WORKFLOW_EXECUTION_ERROR,
  WORKFLOW_STEP_SCHEMA,
} from '../constants/execution';
import type {
  WorkflowHumanStepDefinition,
  WorkflowProcess,
  WorkflowStepDefinition,
} from '../contract/workflow-process.interface';
import {
  createDataSchemaIndex,
  validateFieldValue,
  type DataField,
  type DataSchema,
} from '@/common/automation/data-schema';
import {
  BPMN_KIND_GROUPS,
  BPMN_TYPE,
  WORKFLOW_BPMN_LIMITS,
} from '@/modules/workflow-engine/constants/bpmn';

import type { DefinitionProvision } from '@/common/automation/definition-provision.port';
import type {
  WorkflowBpmnDefinition,
  WorkflowBpmnElement,
  WorkflowBpmnStep,
} from '../contract/workflow-bpmn.types';
import { bpmnCardinalityBinding } from '../domain/workflow-bpmn-expression';

import {
  TASK_EXECUTION,
  type TaskExecutionPort,
} from '@/modules/task-execution/contract/task-execution.port';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { isDeepStrictEqual } from 'node:util';

import {
  DefinitionRepository,
  validateDefinitionInput,
} from '@/common/automation/definition.repository';
import {
  createPublishedResolver,
  publishedReference,
  type PublishedReference,
} from '@/common/automation/definition.types';
import {
  FORM_DEFINITIONS,
  type FormDefinitionPort,
} from '@/modules/form-definition/contract/form.types';
import {
  RULE_ENGINE,
  type RuleEnginePort,
} from '@/modules/rule-engine/contract/rule.types';
import type {
  ValueBinding,
  WorkflowDocument,
  WorkflowIssue,
  WorkflowValidation,
} from '../contract/workflow.types';
import {
  WorkflowDraft,
  WorkflowRevision,
} from '../infrastructure/persistence/workflow.entities';
import { WorkflowProcessRegistry } from './workflow-process.registry';
import { WorkflowScriptRegistry } from './workflow-script.registry';
import {
  isBpmnWorkflow,
  normalizeWorkflowDocument,
  readBpmnContract,
  readBpmnStep,
  workflowContract,
} from '../domain/workflow-document.policy';
import {
  parseWorkflowBpmn,
  validateWorkflowBpmn,
} from '../domain/workflow-bpmn.policy';

type WorkflowInputCheck = {
  id: string;
  schema: DataSchema;
  values: Record<string, ValueBinding>;
};
type WorkflowStepCheckContext = {
  process?: WorkflowProcess;
  steps: ReadonlyMap<string, WorkflowStepDefinition>;
  humanSteps: ReadonlyMap<string, WorkflowHumanStepDefinition>;
  fieldsFor: ReturnType<typeof createDataSchemaIndex>;
  inputs: WorkflowInputCheck[];
  outputs: Map<string, DataSchema>;
  resolveRule: RuleEnginePort['resolve'];
  resolveForm: FormDefinitionPort['resolve'];
  resolveTask: TaskExecutionPort['resolve'];
};

@Injectable()
export class WorkflowDefinitionService {
  readonly definitions: DefinitionRepository<WorkflowDocument>;

  constructor(
    database: DataSource,
    @Inject(RULE_ENGINE) private readonly rules: RuleEnginePort,
    @Inject(FORM_DEFINITIONS) private readonly forms: FormDefinitionPort,
    @Optional()
    @Inject(TASK_EXECUTION)
    private readonly tasks: TaskExecutionPort,
    @Optional()
    private readonly processes: WorkflowProcessRegistry = new WorkflowProcessRegistry(),
    @Optional()
    private readonly scripts: WorkflowScriptRegistry = new WorkflowScriptRegistry(),
  ) {
    this.definitions = new DefinitionRepository(
      database,
      WorkflowDraft,
      WorkflowRevision,
      normalizeWorkflowDocument,
      (definition, reference, manager) =>
        this.activateBusinessVersion(definition, reference, manager),
    );
  }

  /**
   * 为内置计划建立首个标准流程版本，已有资源保留管理员的发布与编辑结果。
   * @param input - 内置来源、初始标准模型与可选保留身份。
   * @returns 创建或复用的工作流资源及其发布版本。
   */
  provision(input: DefinitionProvision<WorkflowBpmnDefinition>) {
    return this.definitions.provision(input, (definition) =>
      this.checkForPublish(definition),
    );
  }

  /**
   * 发布版本与业务统一绑定在同一事务中生效，已有实例继续引用原发布快照。
   * @param definition - 已通过发布校验的工作流模型。
   * @param reference - 本次插入的不可变发布版本。
   * @param manager - 持有发布事务的数据库管理器。
   */
  private async activateBusinessVersion(
    definition: WorkflowDocument,
    reference: PublishedReference,
    manager: EntityManager,
  ): Promise<void> {
    const contract = await workflowContract(definition);
    if (!contract.processRef) return;
    await manager.query(
      `INSERT INTO automation_workflow_business_binding (process_key, scope_id, process_version, workflow_id, workflow_version, revision)
       VALUES (?, 'business', ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE process_version = VALUES(process_version), workflow_id = VALUES(workflow_id), workflow_version = VALUES(workflow_version), revision = revision + 1`,
      [
        contract.processRef.key,
        contract.processRef.version,
        reference.id,
        reference.version,
      ],
    );
  }

  /**
   * 解析固定工作流版本，运行时不读取画布草稿。
   * @param reference - 工作流身份与发布版本。
   * @returns 已发布的执行图和展示布局。
   */
  async resolve(reference: PublishedReference) {
    return this.definitions.published(
      validateDefinitionInput(() => publishedReference(reference)),
    );
  }

  /**
   * 将图语法、拓扑、外部版本、输入映射和表单绑定问题聚合为可定位的校验结果。
   * @param input - 本次提交的完整标准定义。
   * @returns 包含节点和字段位置的完整错误清单。
   */
  async validate(input: unknown): Promise<WorkflowValidation> {
    if (!isBpmnWorkflow(input))
      return {
        valid: false,
        order: [],
        issues: [
          {
            code: 'retired-format',
            message: '仅支持 BPMN 2.0 流程模型，旧自定义图已停用',
          },
        ],
      };
    return this.validateBpmn(input);
  }

  /**
   * 发布前在资源事务中重新验证所有固定依赖，拒绝不可执行的拓扑或失效引用。
   * @param definition - 锁定并规范化的草稿。
   * @throws 任何图或依赖校验失败时返回 HTTP 400。
   */
  async checkForPublish(definition: WorkflowDocument): Promise<void> {
    const validation = await this.validate(definition);
    requireRequest(
      validation.valid,
      validation.issues.map((issue) => issue.message).join('；'),
    );
  }

  /**
   * 分别验证 BPMN 标准结构和 KT 业务依赖，图形位置不参与执行判断。
   * @param input - 已确认使用结构化 BPMN 格式的定义。
   * @returns 标准元素、脚本版本或数据契约的定位问题。
   * @throws 步骤契约或引用无效时转换为定位问题；数据库及未分类故障向上层传播。
   */
  private async validateBpmn(
    input: WorkflowDocument,
  ): Promise<WorkflowValidation> {
    const issues: WorkflowIssue[] = [];
    const fieldsFor = createDataSchemaIndex();
    try {
      const model = await parseWorkflowBpmn(input);
      issues.push(...validateWorkflowBpmn(model));
      const contract = readBpmnContract(model);
      let process: WorkflowProcess | undefined;
      if (contract.processRef) {
        process = this.processes.resolve(contract.processRef);
        if (
          !isDeepStrictEqual(process.inputSchema, contract.inputSchema) ||
          !isDeepStrictEqual(process.outputSchema, contract.outputSchema)
        )
          issues.push({
            code: 'process-contract',
            message: '流程输入输出必须遵守业务接口契约',
          });
      }
      const outputs = new Map<string, DataSchema>();
      const inputs: WorkflowInputCheck[] = [];
      const stepContext: WorkflowStepCheckContext = {
        process,
        fieldsFor,
        inputs,
        outputs,
        resolveRule: createPublishedResolver((reference) =>
          this.rules.resolve(reference),
        ),
        resolveForm: createPublishedResolver((reference) =>
          this.forms.resolve(reference),
        ),
        resolveTask: createPublishedResolver(async (reference) => {
          requireDefinition(
            this.tasks,
            WORKFLOW_EXECUTION_ERROR.actionUnavailable,
          );
          return this.tasks.resolve(reference);
        }),
        steps: new Map((process?.steps ?? []).map((step) => [step.key, step])),
        humanSteps: new Map(
          (process?.humanSteps ?? []).map((step) => [step.key, step]),
        ),
      };
      for (const element of Object.values(model.elements)) {
        try {
          await this.checkStepContracts(element, stepContext);
        } catch (error) {
          issues.push({
            nodeId: element.id,
            code: 'step-contract',
            message: definitionRejectionMessage(error),
          });
        }
      }
      for (const element of Object.values(model.elements)) {
        const cardinality = element.loopCharacteristics?.loopCardinality;
        if (!cardinality) continue;
        try {
          const binding = bpmnCardinalityBinding(cardinality.body);
          this.checkBindings(
            { count: binding },
            {
              target: {
                fields: [
                  {
                    key: 'count',
                    label: '实例数量',
                    type: 'integer',
                    required: true,
                    min: 0,
                    max: WORKFLOW_BPMN_LIMITS.maxInstances,
                  },
                ],
              },
              input: contract.inputSchema,
              outputs: outputs,
              fieldsFor,
              nodeId: element.id,
            },
            issues,
          );
        } catch (error) {
          issues.push({
            nodeId: element.id,
            code: 'loop-cardinality',
            message: definitionRejectionMessage(error),
          });
        }
      }
      for (const target of inputs)
        this.checkBindings(
          target.values,
          {
            target: target.schema,
            input: contract.inputSchema,
            outputs: outputs,
            fieldsFor,
            nodeId: target.id,
            iterationAvailable: Boolean(
              model.elements[target.id]?.loopCharacteristics,
            ),
          },
          issues,
        );
      this.checkBindings(
        contract.output,
        {
          target: contract.outputSchema,
          input: contract.inputSchema,
          outputs: outputs,
          fieldsFor,
        },
        issues,
      );
      if (contract.processRef && contract.formRef)
        issues.push({
          code: 'business-form',
          message: '业务创建即入流，表单必须配置在流程人工节点中',
        });
      if (contract.formRef) {
        const form = await stepContext.resolveForm(contract.formRef);
        const bindings: Record<string, ValueBinding> = {};
        for (const [key, field] of Object.entries(contract.formMapping))
          bindings[key] = { type: 'input', field };
        let submissionSchema = contract.inputSchema;
        if (process) submissionSchema = process.launchSchema ?? { fields: [] };
        this.checkBindings(
          bindings,
          {
            target: submissionSchema,
            input: form.dataSchema,
            outputs: new Map(),
            fieldsFor,
          },
          issues,
        );
      } else if (Object.keys(contract.formMapping).length)
        issues.push({
          code: 'form-reference',
          message: '字段映射需要固定表单版本',
        });
    } catch (error) {
      issues.push({
        code: 'bpmn-schema',
        message: definitionRejectionMessage(error),
      });
    }
    return { valid: issues.length === 0, issues, order: [] };
  }

  /**
   * 按步骤类别收集固定输入和输出契约，每类步骤只读取自己的端口，业务能力按本批索引定位。
   * @param element - 当前标准活动。
   * @param context - 固定业务接口、能力索引与本批输入输出收集器。
   */
  private async checkStepContracts(
    element: WorkflowBpmnElement,
    context: WorkflowStepCheckContext,
  ): Promise<void> {
    const step = readBpmnStep(element);
    requireDefinition(
      step || !BPMN_KIND_GROUPS.managedTasks.has(element.$type),
      '可执行任务必须绑定工作流步骤',
    );
    if (!step) return;
    if (step.kind === 'human') {
      await this.checkHumanContract(element.id, step, context);
      return;
    }
    if (step.kind === 'action') {
      const action = await context.resolveTask(step.taskRef);
      requireDefinition(action.available, '内置动作能力当前不可用');
      context.inputs.push({
        id: element.id,
        schema: action.inputSchema,
        values: step.input,
      });
      context.outputs.set(element.id, action.outputSchema);
      return;
    }
    if (step.kind === 'rule') {
      requireDefinition(
        element.$type === BPMN_TYPE.BusinessRuleTask,
        '规则求值必须使用业务规则任务',
      );
      const rule = await context.resolveRule(step.ruleRef);
      context.inputs.push({
        id: element.id,
        schema: rule.factSchema,
        values: step.input,
      });
      context.outputs.set(element.id, ruleOutputSchema(rule));
      return;
    }
    const process = context.process;
    requireDefinition(process, '脚本任务必须绑定业务流程接口');
    const descriptor = context.steps.get(step.stepKey);
    requireDefinition(descriptor, '业务接口未实现引用步骤');
    requireDefinition(step.scripts.length, '步骤必须声明有序的固定脚本版本');
    for (const call of step.scripts) {
      const script = this.scripts.check(call, process.key, step.stepKey);
      const values: Record<string, ValueBinding> = {};
      for (const [key, value] of Object.entries(script.defaults))
        values[key] = { type: 'literal', value };
      Object.assign(values, call.params);
      const schema = {
        fields: script.paramsSchema.fields.map((field) => ({
          ...field,
          required: field.required && Object.hasOwn(values, field.key),
        })),
      };
      context.inputs.push({ id: element.id, schema, values });
    }
    context.inputs.push({
      id: element.id,
      schema: descriptor.inputSchema,
      values: step.input,
    });
    context.outputs.set(element.id, descriptor.outputSchema);
  }

  /**
   * 校验人工表单的可写范围，并合并互不覆盖的业务权威结果，字段成员检查均使用索引。
   * @param id - 当前人工活动的标准身份。
   * @param step - 固定表单版本、可写字段和可选业务能力。
   * @param context - 本批共享的契约与字段索引。
   */
  private async checkHumanContract(
    id: string,
    step: Extract<WorkflowBpmnStep, { kind: 'human' }>,
    context: WorkflowStepCheckContext,
  ): Promise<void> {
    let output: DataSchema = WORKFLOW_STEP_SCHEMA.confirmation;
    if (step.formRef) {
      const form = await context.resolveForm(step.formRef);
      const formFields = context.fieldsFor(form.dataSchema);
      const writable = new Set(step.writableFields);
      requireDefinition(
        step.writableFields.every((key) => formFields.has(key)),
        '人工任务引用了表单不存在的可写字段',
      );
      const schema = {
        fields: form.dataSchema.fields.map((field) => ({
          ...field,
          required: field.required && !writable.has(field.key),
        })),
      };
      context.inputs.push({ id, schema, values: step.input });
      output = form.dataSchema;
    }
    if (!step.businessKey) {
      context.outputs.set(id, output);
      return;
    }
    const capability = context.humanSteps.get(step.businessKey);
    requireDefinition(
      capability && context.process?.acceptHumanStep,
      '业务未实现此人工办理能力',
    );
    const businessFields = context.fieldsFor(capability.outputSchema);
    requireDefinition(
      output.fields.every((field) => !businessFields.has(field.key)),
      '表单字段不能覆盖业务权威结果字段',
    );
    context.outputs.set(id, {
      fields: [...output.fields, ...capability.outputSchema.fields],
    });
  }

  /**
   * 按目标字段检查映射来源类型、必填性及常量约束，并保留错误所在节点。
   * @param context - 目标与来源契约、共享字段索引及当前节点的循环能力。
   * @param bindings - 当前节点或流程输出的变量绑定。
   * @param issues - 当前校验累计的定位错误。
   * @throws 来源字段缺失、类型不匹配或必填性不满足时中止该映射，由本方法收集字段错误。
   */
  private checkBindings(
    bindings: Record<string, ValueBinding>,
    context: {
      target: DataSchema;
      input: DataSchema;
      outputs: ReadonlyMap<string, DataSchema>;
      fieldsFor: ReturnType<typeof createDataSchemaIndex>;
      nodeId?: string;
      iterationAvailable?: boolean;
    },
    issues: WorkflowIssue[],
  ): void {
    const { target, input, outputs, fieldsFor, nodeId, iterationAvailable } =
      context;
    const targetFields = fieldsFor(target);
    const inputFields = fieldsFor(input);
    for (const field of target.fields) {
      if (field.required && !bindings[field.key])
        issues.push({
          nodeId,
          fieldPath: field.key,
          code: 'required-binding',
          message: `${field.label}：缺少必填映射`,
        });
    }
    for (const [key, binding] of Object.entries(bindings)) {
      const field = targetFields.get(key);
      if (!field) {
        issues.push({
          nodeId,
          fieldPath: key,
          code: 'unknown-binding',
          message: '映射目标字段未声明',
        });
        continue;
      }
      try {
        if (binding.type === 'literal') {
          validateFieldValue(field, binding.value);
          continue;
        }
        if (binding.type === 'iteration') {
          requireDefinition(
            iterationAvailable &&
              (field.type === 'integer' || field.type === 'number'),
            `${field.label}：循环序号只能用于循环活动的数值字段`,
          );
          continue;
        }
        let references = [binding];
        if (binding.type === 'first') references = binding.sources;
        let hasRequiredSource = false;
        for (const reference of references) {
          let source: DataField | undefined;
          if (reference.type === 'input')
            source = inputFields.get(reference.field);
          if (reference.type === 'node') {
            const schema = outputs.get(reference.nodeId);
            if (schema) source = fieldsFor(schema).get(reference.field);
          }
          requireDefinition(
            source &&
              (source.type === field.type ||
                (source.type === 'integer' && field.type === 'number')) &&
              source.format === field.format,
            `${field.label}：来源字段不存在或类型不相容`,
          );
          if (source.required) hasRequiredSource = true;
        }
        requireDefinition(
          !field.required || hasRequiredSource,
          `${field.label}：必填目标不能依赖可缺失字段`,
        );
      } catch (error) {
        issues.push({
          nodeId,
          fieldPath: key,
          code: 'binding-type',
          message: definitionRejectionMessage(error),
        });
      }
    }
  }
}
