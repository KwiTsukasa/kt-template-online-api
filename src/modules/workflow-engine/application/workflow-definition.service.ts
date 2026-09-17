import type { DefinitionProvision } from '@/common/automation/definition-provision.port';
import type { WorkflowBpmnDefinition } from '../contract/workflow-bpmn.types';
import { bpmnCardinalityBinding } from '../domain/workflow-bpmn-expression';
import { WORKFLOW_BPMN_LIMITS } from '../domain/workflow-bpmn-limits';
import {
  TASK_EXECUTION,
  type TaskExecutionPort,
} from '@/modules/task-execution/contract/task-execution.port';
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { isDeepStrictEqual } from 'node:util';
import {
  validateFieldValue,
  type DataField,
  type DataSchema,
} from '@/common/automation/data-schema';
import {
  DefinitionRepository,
  validateDefinitionInput,
} from '@/common/automation/definition.repository';
import {
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
   * @param input - 固定来源键和标准 BPMN 初始定义。
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
   * @param input - 当前工作流草稿。
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
    if (!validation.valid)
      throw new BadRequestException(
        validation.issues.map((issue) => issue.message).join('；'),
      );
  }

  /**
   * 分别验证 BPMN 标准结构和 KT 业务依赖，图形位置不参与执行判断。
   * @param input - 唯一权威的结构化标准定义。
   * @returns 标准元素、脚本版本或数据契约的定位问题。
   * @throws 步骤契约或引用无效时在内部抛错并转换为定位问题，不向调用者泄漏执行异常。
   */
  private async validateBpmn(
    input: WorkflowDocument,
  ): Promise<WorkflowValidation> {
    const issues: WorkflowIssue[] = [];
    try {
      const model = await parseWorkflowBpmn(input);
      issues.push(...validateWorkflowBpmn(model));
      const contract = readBpmnContract(model);
      let process = null;
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
      const inputs: Array<{
        id: string;
        schema: DataSchema;
        values: Record<string, ValueBinding>;
      }> = [];
      for (const element of Object.values(model.elements)) {
        try {
          const step = readBpmnStep(element);
          if (!step) {
            if (
              [
                'bpmn:ServiceTask',
                'bpmn:ScriptTask',
                'bpmn:BusinessRuleTask',
                'bpmn:SendTask',
                'bpmn:UserTask',
              ].includes(element.$type)
            )
              throw new Error('可执行任务必须绑定工作流步骤');
            continue;
          }
          if (step.kind === 'human') {
            if (step.formRef) {
              const form = await this.forms.resolve(step.formRef);
              if (
                step.writableFields.some(
                  (key) =>
                    !form.dataSchema.fields.some((field) => field.key === key),
                )
              )
                throw new Error('人工任务引用了表单不存在的可写字段');
              const initialSchema = {
                fields: form.dataSchema.fields.map((field) => ({
                  ...field,
                  required:
                    field.required && !step.writableFields.includes(field.key),
                })),
              };
              inputs.push({
                id: element.id,
                schema: initialSchema,
                values: step.input,
              });
              outputs.set(element.id, form.dataSchema);
            } else
              outputs.set(element.id, {
                fields: [
                  {
                    key: 'confirmed',
                    label: '已确认',
                    type: 'boolean',
                    required: true,
                  },
                ],
              });
            if (step.businessKey) {
              const capability = process?.humanSteps?.find(
                (item) => item.key === step.businessKey,
              );
              if (!capability || !process.acceptHumanStep)
                throw new Error('业务未实现此人工办理能力');
              const schema = outputs.get(element.id)!;
              if (
                schema.fields.some((field) =>
                  capability.outputSchema.fields.some(
                    (businessField) => businessField.key === field.key,
                  ),
                )
              )
                throw new Error('表单字段不能覆盖业务权威结果字段');
              outputs.set(element.id, {
                fields: [...schema.fields, ...capability.outputSchema.fields],
              });
            }
          } else if (step.kind === 'action') {
            if (!this.tasks) throw new Error('内置动作能力未装配');
            const action = await this.tasks.resolve(step.taskRef);
            if (!action.available) throw new Error('内置动作能力当前不可用');
            inputs.push({
              id: element.id,
              schema: action.inputSchema,
              values: step.input,
            });
            outputs.set(element.id, action.outputSchema);
          } else if (step.kind === 'rule') {
            if (element.$type !== 'bpmn:BusinessRuleTask')
              throw new Error('规则求值必须使用业务规则任务');
            const rule = await this.rules.resolve(step.ruleRef);
            inputs.push({
              id: element.id,
              schema: rule.factSchema,
              values: step.input,
            });
            if (rule.mode === 'condition')
              outputs.set(element.id, {
                fields: [
                  {
                    key: 'result',
                    label: '规则结果',
                    type: 'boolean',
                    required: true,
                  },
                ],
              });
          } else {
            if (!process) throw new Error('脚本任务必须绑定业务流程接口');
            const descriptor = process.steps.find(
              (candidate) => candidate.key === step.stepKey,
            );
            if (!descriptor) throw new Error('业务接口未实现引用步骤');
            if (!step.scripts.length)
              throw new Error('步骤必须声明有序的固定脚本版本');
            for (const call of step.scripts) {
              const script = this.scripts.check(
                call,
                process.key,
                step.stepKey,
              );
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
              inputs.push({ id: element.id, schema, values });
            }
            inputs.push({
              id: element.id,
              schema: descriptor.inputSchema,
              values: step.input,
            });
            outputs.set(element.id, descriptor.outputSchema);
          }
        } catch (error) {
          issues.push({
            nodeId: element.id,
            code: 'step-contract',
            message: String(error),
          });
        }
      }
      for (const element of Object.values(model.elements)) {
        const cardinality = element.loopCharacteristics?.loopCardinality;
        if (!cardinality) continue;
        try {
          const binding = bpmnCardinalityBinding(cardinality.body);
          this.checkBindings(
            {
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
            { count: binding },
            contract.inputSchema,
            outputs,
            issues,
            element.id,
          );
        } catch (error) {
          issues.push({
            nodeId: element.id,
            code: 'loop-cardinality',
            message: String(error),
          });
        }
      }
      for (const target of inputs)
        this.checkBindings(
          target.schema,
          target.values,
          contract.inputSchema,
          outputs,
          issues,
          target.id,
          Boolean(model.elements[target.id]?.loopCharacteristics),
        );
      this.checkBindings(
        contract.outputSchema,
        contract.output,
        contract.inputSchema,
        outputs,
        issues,
      );
      if (contract.processRef && contract.formRef)
        issues.push({
          code: 'business-form',
          message: '业务创建即入流，表单必须配置在流程人工节点中',
        });
      if (contract.formRef) {
        const form = await this.forms.resolve(contract.formRef);
        const bindings: Record<string, ValueBinding> = {};
        for (const [key, field] of Object.entries(contract.formMapping))
          bindings[key] = { type: 'input', field };
        let submissionSchema = contract.inputSchema;
        if (process) submissionSchema = process.launchSchema ?? { fields: [] };
        this.checkBindings(
          submissionSchema,
          bindings,
          form.dataSchema,
          new Map(),
          issues,
        );
      } else if (Object.keys(contract.formMapping).length)
        issues.push({
          code: 'form-reference',
          message: '字段映射需要固定表单版本',
        });
    } catch (error) {
      issues.push({ code: 'bpmn-schema', message: String(error) });
    }
    return { valid: issues.length === 0, issues, order: [] };
  }

  /**
   * 按目标字段检查映射来源类型、必填性及常量约束，并保留错误所在节点。
   * @param target - 接收数据的字段结构。
   * @param bindings - 当前节点或流程输出的变量绑定。
   * @param input - 可引用的流程输入结构。
   * @param outputs - 上游原子任务声明的输出结构。
   * @param issues - 当前校验累计的定位错误。
   * @param nodeId - 当前节点标识，流程级映射可省略。
   * @param iterationAvailable - 当前活动是否声明循环，仅此时允许读取循环序号。
   * @throws 来源字段缺失、类型不匹配或必填性不满足时中止该映射，由本方法收集字段错误。
   */
  private checkBindings(
    target: DataSchema,
    bindings: Record<string, ValueBinding>,
    input: DataSchema,
    outputs: Map<string, DataSchema>,
    issues: WorkflowIssue[],
    nodeId?: string,
    iterationAvailable = false,
  ): void {
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
      const field = target.fields.find((candidate) => candidate.key === key);
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
          if (
            !iterationAvailable ||
            !['integer', 'number'].includes(field.type)
          )
            throw new Error(
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
            source = input.fields.find(
              (candidate) => candidate.key === reference.field,
            );
          if (reference.type === 'node')
            source = outputs
              .get(reference.nodeId)
              ?.fields.find((candidate) => candidate.key === reference.field);
          if (
            !source ||
            (source.type !== field.type &&
              !(source.type === 'integer' && field.type === 'number')) ||
            source.format !== field.format
          )
            throw new Error(`${field.label}：来源字段不存在或类型不相容`);
          if (source.required) hasRequiredSource = true;
        }
        if (field.required && !hasRequiredSource)
          throw new Error(`${field.label}：必填目标不能依赖可缺失字段`);
      } catch (error) {
        issues.push({
          nodeId,
          fieldPath: key,
          code: 'binding-type',
          message: String(error),
        });
      }
    }
  }
}
