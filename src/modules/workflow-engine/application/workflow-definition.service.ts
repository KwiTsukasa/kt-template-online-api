import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
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
import {
  TASK_EXECUTION,
  type TaskExecutionPort,
} from '@/modules/task-execution/contract/task-execution.port';
import type {
  ValueBinding,
  WorkflowDefinition,
  WorkflowIssue,
  WorkflowValidation,
} from '../contract/workflow.types';
import {
  normalizeWorkflowDefinition,
  validateWorkflowGraph,
} from '../domain/workflow.policy';
import {
  WorkflowDraft,
  WorkflowRevision,
} from '../infrastructure/persistence/workflow.entities';

@Injectable()
export class WorkflowDefinitionService {
  readonly definitions: DefinitionRepository<WorkflowDefinition>;

  constructor(
    database: DataSource,
    @Inject(RULE_ENGINE) private readonly rules: RuleEnginePort,
    @Inject(FORM_DEFINITIONS) private readonly forms: FormDefinitionPort,
    @Optional()
    @Inject(TASK_EXECUTION)
    private readonly tasks?: TaskExecutionPort,
  ) {
    this.definitions = new DefinitionRepository(
      database,
      WorkflowDraft,
      WorkflowRevision,
      normalizeWorkflowDefinition,
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
   * @throws 引用端口不可用或规则分支未覆盖时中止该节点校验，由本方法转换为定位错误。
   */
  async validate(input: unknown): Promise<WorkflowValidation> {
    let definition: WorkflowDefinition;
    try {
      definition = normalizeWorkflowDefinition(input);
    } catch (error) {
      return {
        valid: false,
        order: [],
        issues: [{ code: 'schema', message: String(error) }],
      };
    }
    const validation = validateWorkflowGraph(definition.graph);
    const outputs = new Map<string, DataSchema>();
    const inputs = new Map<
      string,
      { schema: DataSchema; values: Record<string, ValueBinding> }
    >();
    for (const node of definition.graph.nodes) {
      try {
        if (node.type === 'task') {
          if (!this.tasks) throw new Error('原子任务执行端口当前不可用');
          const task = await this.tasks.resolve(node.taskRef);
          if (!task.available) throw new Error('引用任务当前不可用');
          outputs.set(node.id, task.outputSchema);
          inputs.set(node.id, { schema: task.inputSchema, values: node.input });
        }
        if (node.type === 'rule') {
          const rule = await this.rules.resolve(node.ruleRef);
          const values = [];
          if (rule.mode === 'condition') values.push(true, false);
          else
            values.push(
              rule.defaultResult,
              ...rule.rows.map((row) => row.result),
            );
          const expected = [
            ...new Set(values.map((value) => JSON.stringify(value))),
          ];
          if (
            node.branches.length !== expected.length ||
            expected.some(
              (value) =>
                !node.branches.some(
                  (branch) => JSON.stringify(branch.value) === value,
                ),
            )
          )
            throw new Error('规则分支必须覆盖该版本的全部决策结果');
          inputs.set(node.id, { schema: rule.factSchema, values: node.facts });
        }
      } catch (error) {
        validation.issues.push({
          nodeId: node.id,
          code: 'dependency',
          message: String(error),
        });
      }
    }
    for (const [nodeId, target] of inputs)
      this.checkBindings(
        target.schema,
        target.values,
        definition.graph.inputSchema,
        outputs,
        validation.issues,
        nodeId,
      );
    this.checkBindings(
      definition.graph.outputSchema,
      definition.graph.output,
      definition.graph.inputSchema,
      outputs,
      validation.issues,
    );
    if (definition.graph.formRef) {
      try {
        const form = await this.forms.resolve(definition.graph.formRef);
        const bindings: Record<string, ValueBinding> = {};
        for (const [target, field] of Object.entries(
          definition.graph.formMapping,
        ))
          bindings[target] = { type: 'input', field };
        this.checkBindings(
          definition.graph.inputSchema,
          bindings,
          form.dataSchema,
          new Map(),
          validation.issues,
        );
      } catch (error) {
        validation.issues.push({
          code: 'form-reference',
          message: String(error),
        });
      }
    } else if (Object.keys(definition.graph.formMapping).length)
      validation.issues.push({
        code: 'form-mapping',
        message: '没有绑定表单时不能保存表单映射',
      });
    validation.valid = validation.issues.length === 0;
    return validation;
  }

  /**
   * 发布前在资源事务中重新验证所有固定依赖，拒绝不可执行的拓扑或失效引用。
   * @param definition - 锁定并规范化的草稿。
   * @throws 任何图或依赖校验失败时返回 HTTP 400。
   */
  async checkForPublish(definition: WorkflowDefinition): Promise<void> {
    const validation = await this.validate(definition);
    if (!validation.valid)
      throw new BadRequestException(
        validation.issues.map((issue) => issue.message).join('；'),
      );
  }

  /**
   * 按目标字段检查映射来源类型、必填性及常量约束，并保留错误所在节点。
   * @param target - 接收数据的字段结构。
   * @param bindings - 当前节点或流程输出的变量绑定。
   * @param input - 可引用的流程输入结构。
   * @param outputs - 上游原子任务声明的输出结构。
   * @param issues - 当前校验累计的定位错误。
   * @param nodeId - 当前节点标识，流程级映射可省略。
   * @throws 来源字段缺失、类型不匹配或必填性不满足时中止该映射，由本方法收集字段错误。
   */
  private checkBindings(
    target: DataSchema,
    bindings: Record<string, ValueBinding>,
    input: DataSchema,
    outputs: Map<string, DataSchema>,
    issues: WorkflowIssue[],
    nodeId?: string,
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
        let source: DataField | undefined;
        if (binding.type === 'input')
          source = input.fields.find(
            (candidate) => candidate.key === binding.field,
          );
        if (binding.type === 'node')
          source = outputs
            .get(binding.nodeId)
            ?.fields.find((candidate) => candidate.key === binding.field);
        if (
          !source ||
          (source.type !== field.type &&
            !(source.type === 'integer' && field.type === 'number')) ||
          source.format !== field.format
        )
          throw new Error(`${field.label}：来源字段不存在或类型不相容`);
        if (field.required && !source.required)
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
