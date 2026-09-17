import { requireDefinition } from '@/common/automation/validation';
import {
  BPMN_KIND_GROUPS,
  BPMN_EXTENSION,
  BPMN_TYPE,
} from '@/modules/workflow-engine/constants/bpmn';

import { normalizeDataSchema } from '@/common/automation/data-schema';
import {
  definitionRecord,
  publishedReference,
} from '@/common/automation/definition.types';
import type { WorkflowDocument } from '../contract/workflow.types';
import type {
  WorkflowBpmnContract,
  WorkflowBpmnDefinition,
  WorkflowBpmnModel,
  WorkflowBpmnStep,
  WorkflowBpmnElement,
} from '../contract/workflow-bpmn.types';
import {
  parseWorkflowBpmn,
  readWorkflowBpmnExtension,
} from './workflow-bpmn.policy';
import { normalizeBindings } from './workflow-value-binding.policy';
import { normalizeWorkflowScripts } from './workflow-script.policy';

/**
 * 按显式格式识别唯一允许保存和执行的标准流程模型。
 * @param input - 待检查的工作流定义。
 * @returns 是否声明结构化 BPMN 模型格式。
 */
export function isBpmnWorkflow(
  input: unknown,
): input is WorkflowBpmnDefinition {
  return (
    !!input &&
    typeof input === 'object' &&
    (input as WorkflowBpmnDefinition).format === 'bpmn20'
  );
}

/**
 * 保存时从标准模型 重新生成业务检索索引，客户端同名字段不能改变流程绑定。
 * @param input - 待保存的结构化标准模型。
 * @returns 从标准模型生成的定义与业务检索索引。
 * @throws 旧自定义图、标准模型或业务扩展不合法时拒绝保存。
 */
export async function normalizeWorkflowDocument(
  input: unknown,
): Promise<WorkflowDocument> {
  requireDefinition(
    isBpmnWorkflow(input),
    '仅支持 BPMN 2.0 流程模型，旧自定义图已停用',
  );
  const model = await parseWorkflowBpmn(input);
  const contract = readBpmnContract(model);
  for (const element of Object.values(model.elements)) readBpmnStep(element);
  return { ...model.definition, processRef: contract.processRef };
}

/**
 * 读取标准流程的业务扩展，未绑定业务的导入模型使用空数据契约。
 * @param model - 已解析的标准定义。
 * @returns 从标准模型 校验得到的输入输出、业务绑定和总期限。
 * @throws 多入口业务契约、无效版本、映射或期限时拒绝解析。
 */
export function readBpmnContract(
  model: WorkflowBpmnModel,
): WorkflowBpmnContract {
  const executable = model.processes.filter((process) => process.isExecutable);
  requireDefinition(
    executable.length <= 1,
    '一个工作流发布版本只能有一个可执行入口；被调用流程应设为非入口',
  );
  const process = executable[0] ?? model.processes[0];
  requireDefinition(process, '工作流必须包含流程定义');
  const raw = readWorkflowBpmnExtension<Record<string, unknown>>(
    process,
    BPMN_EXTENSION.Contract,
  );
  if (!raw)
    return {
      processRef: null,
      inputSchema: { fields: [] },
      outputSchema: { fields: [] },
      output: {},
      formRef: null,
      formMapping: {},
      timeoutMs: 86400000,
    };
  let processRef = null;
  if (raw.processRef !== null && raw.processRef !== undefined) {
    const ref = definitionRecord(raw.processRef);
    requireDefinition(
      typeof ref.key === 'string' &&
        /^[a-z][a-z0-9.-]{2,63}$/.test(ref.key) &&
        Number.isSafeInteger(ref.version) &&
        Number(ref.version) >= 1,
      '业务流程接口引用不合法',
    );
    processRef = { key: ref.key, version: Number(ref.version) };
  }
  let formRef = null;
  if (raw.formRef !== null && raw.formRef !== undefined)
    formRef = publishedReference(raw.formRef);
  const formMapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    definitionRecord(raw.formMapping ?? {}),
  )) {
    const binding = normalizeBindings({
      [key]: { type: 'input', field: value },
    });
    if (binding[key].type === 'input') formMapping[key] = binding[key].field;
  }
  requireDefinition(
    Number.isSafeInteger(raw.timeoutMs) &&
      Number(raw.timeoutMs) >= 1000 &&
      Number(raw.timeoutMs) <= 31 * 86400000,
    '流程期限需要 1 秒至 31 天',
  );
  return {
    processRef,
    formRef,
    formMapping,
    timeoutMs: Number(raw.timeoutMs),
    inputSchema: normalizeDataSchema(raw.inputSchema),
    outputSchema: normalizeDataSchema(raw.outputSchema),
    output: normalizeBindings(raw.output),
  };
}

/**
 * 校验标准活动上的工作流步骤扩展，脚本参数仍复用工作流统一协议。
 * @param element - 标准任务或其他模型元素。
 * @returns 规范化步骤；未配置步骤时为空。
 * @throws 扩展挂载位置、步骤类别、版本或参数无效时拒绝保存。
 */
export function readBpmnStep(
  element: WorkflowBpmnElement,
): WorkflowBpmnStep | null {
  const raw = readWorkflowBpmnExtension<Record<string, unknown>>(
    element,
    BPMN_EXTENSION.Step,
  );
  if (!raw) return null;
  requireDefinition(
    BPMN_KIND_GROUPS.managedTasks.has(element.$type),
    '工作流步骤只能绑定到受控任务活动',
  );
  const input = normalizeBindings(raw.input);
  if (raw.kind === 'human') {
    requireDefinition(
      element.$type === BPMN_TYPE.UserTask,
      '人工办理必须使用用户任务',
    );
    requireDefinition(
      Array.isArray(raw.writableFields) &&
        !raw.writableFields.some((key) => typeof key !== 'string') &&
        new Set(raw.writableFields).size === raw.writableFields.length,
      '人工任务可写字段必须是不重复的字段列表',
    );
    let formRef = null;
    if (raw.formRef !== null && raw.formRef !== undefined)
      formRef = publishedReference(raw.formRef);
    requireDefinition(
      formRef || (!raw.writableFields.length && !Object.keys(input).length),
      '无表单的人工确认不能声明表单字段',
    );
    requireDefinition(
      raw.businessKey === undefined ||
        (typeof raw.businessKey === 'string' &&
          /^[a-z][a-z0-9.-]{1,63}$/.test(raw.businessKey)),
      '人工办理业务能力标识无效',
    );
    const businessKey = raw.businessKey as string | undefined;
    return {
      kind: 'human',
      businessKey,
      formRef,
      writableFields: raw.writableFields as string[],
      input,
    };
  }
  requireDefinition(
    element.$type !== BPMN_TYPE.UserTask,
    '用户任务只能配置人工办理',
  );
  if (raw.kind === 'action') {
    requireDefinition(
      element.$type === BPMN_TYPE.ServiceTask,
      '内置动作必须使用服务任务',
    );
    return { kind: 'action', taskRef: publishedReference(raw.taskRef), input };
  }
  if (raw.kind === 'rule')
    return { kind: 'rule', ruleRef: publishedReference(raw.ruleRef), input };
  requireDefinition(
    raw.kind === 'business' || raw.kind === 'script',
    '工作流步骤类别不支持',
  );
  requireDefinition(
    typeof raw.stepKey === 'string' &&
      /^[a-z][a-z0-9.-]{1,63}$/.test(raw.stepKey),
    '工作流步骤身份无效',
  );
  return {
    kind: raw.kind,
    stepKey: raw.stepKey,
    input,
    scripts: normalizeWorkflowScripts(raw.scripts),
  };
}

/**
 * 从不可变标准定义读取业务契约，不信任客户端提供的检索索引。
 * @param definition - 已发布的工作流定义。
 * @returns 可用于权限绑定、输入校验和输出映射的业务契约。
 * @throws 旧自定义图不能提供可执行业务契约。
 */
export async function workflowContract(
  definition: WorkflowDocument,
): Promise<WorkflowBpmnContract> {
  requireDefinition(
    isBpmnWorkflow(definition),
    '旧自定义图已停用，请使用 BPMN 2.0 流程模型',
  );
  return readBpmnContract(await parseWorkflowBpmn(definition));
}
