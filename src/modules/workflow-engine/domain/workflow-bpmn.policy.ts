import { bpmnPath } from './workflow-bpmn-path';
import { requireDefinition } from '@/common/automation/validation';
import { BPMN_CONDITION_ERRORS } from '../constants/bpmn';
import { WorkflowBpmnModelIndex } from './workflow-bpmn-index';
import {
  BPMN_KIND_GROUPS,
  BPMN_EXTENSION,
  BPMN_TYPE,
  BPMN_FORMAT,
  KT_BPMN_EXPRESSION,
  KT_BPMN_MODDLE,
  KT_BPMN_STEP,
} from '@/modules/workflow-engine/constants/bpmn';
import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';

/// <reference types="../contract/bpmn-moddle" />
import * as BpmnModdle from 'bpmn-moddle';
import {
  type WorkflowBpmnDefinition,
  type WorkflowBpmnElement,
  type WorkflowBpmnIssue,
  type WorkflowBpmnModel,
} from '../contract/workflow-bpmn.types';
import {
  dehydrateWorkflowBpmn,
  hydrateWorkflowBpmn,
} from './workflow-bpmn-model';
import { validateBpmnCorrelations } from './workflow-bpmn-correlation';
import { bpmnConditionType } from './workflow-bpmn-expression';

/**
 * 从内部结构化模型恢复完整 BPMN 元模型，不生成 XML。
 * @param input - 带格式标记的结构化 BPMN 定义。
 * @returns 保留标准属性、DI 与命名空间扩展的模型。
 * @throws 格式、长度、标准元素或引用不合法时拒绝接收。
 */
export async function parseWorkflowBpmn(
  input: unknown,
): Promise<WorkflowBpmnModel> {
  return hydrateWorkflowBpmn(input);
}

/**
 * 将外部 BPMN XML 导入为内部结构化模型；解析后不持久化 XML 文本。
 * @param xml - 显式导入的标准 XML 内容。
 * @returns 与编辑和执行共用的结构化 BPMN 定义。
 * @throws XML、实体声明或无法保留的标准元素不合法时拒绝导入。
 */
export async function importWorkflowBpmnXml(
  xml: string,
): Promise<WorkflowBpmnDefinition> {
  requireDefinition(
    typeof xml === 'string' &&
      xml.trim() &&
      Buffer.byteLength(xml, 'utf8') <= 2 * 1024 * 1024,
    'BPMN XML 不能为空且不能超过 2 MiB',
  );
  requireDefinition(
    !/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml),
    'BPMN XML 不允许 DTD 或实体声明',
  );
  const moddle = new BpmnModdle({ kt: KT_BPMN_MODDLE });
  const parsed = await moddle.fromXML(xml);
  requireDefinition(
    !parsed.warnings.length,
    `BPMN XML 包含未解析内容：${parsed.warnings.map((item) => item.message).join('；')}`,
  );
  requireDefinition(
    parsed.rootElement.$type === BPMN_TYPE.Definitions,
    'BPMN XML 根节点必须是 definitions',
  );
  return hydrateWorkflowBpmn({
    format: BPMN_FORMAT,
    model: dehydrateWorkflowBpmn(parsed.rootElement as WorkflowBpmnElement),
  }).definition;
}

/**
 * 将修改后的元模型写回结构化定义，编辑保存不进行 XML 序列化。
 * @param root - 编辑器拥有的 BPMN definitions 元素。
 * @returns 经引用与类型校验的结构化定义。
 * @throws 导出后模型无法完整解析时拒绝保存。
 */
export async function serializeWorkflowBpmn(
  root: WorkflowBpmnElement,
): Promise<WorkflowBpmnDefinition> {
  return hydrateWorkflowBpmn({
    format: BPMN_FORMAT,
    model: dehydrateWorkflowBpmn(root),
  }).definition;
}

/**
 * 仅在显式导出时把当前标准模型和 DI 转换成 BPMN XML 文件内容。
 * @param definition - 当前草稿或固定版本的结构化模型。
 * @returns 可下载为 .bpmn 文件的标准 XML 内容。
 * @throws 内部模型或引用不合法时拒绝导出。
 */
export async function exportWorkflowBpmnXml(
  definition: WorkflowBpmnDefinition,
): Promise<string> {
  const model = hydrateWorkflowBpmn(definition);
  const moddle = new BpmnModdle({ kt: KT_BPMN_MODDLE });
  const { xml } = await moddle.toXML(model.root, { format: true });
  return xml;
}

/**
 * 读取指定 KT 扩展的 JSON 内容，重复声明或非对象内容不能成为执行契约。
 * @param element - 扩展所附着的标准 BPMN 元素。
 * @param type - 已声明的 KT 扩展类型。
 * @returns 扩展对象；未配置时为空。
 * @throws 重复扩展、无效 JSON 或危险属性路径时拒绝读取。
 */
export function readWorkflowBpmnExtension<T>(
  element: WorkflowBpmnElement,
  type: typeof BPMN_EXTENSION.Contract | typeof BPMN_EXTENSION.Step,
): T | null {
  const entries: WorkflowBpmnElement[] = (
    element.extensionElements?.values || []
  ).filter((value: WorkflowBpmnElement) => value.$type === type);
  if (!entries.length) return null;
  requireDefinition(
    entries.length === 1,
    `${element.id} 只能有一个 ${type} 扩展`,
  );
  const value = JSON.parse(entries[0].body, (key, item) => {
    requireDefinition(
      !FORBIDDEN_OBJECT_KEYS.has(key),
      '业务扩展包含不允许的属性',
    );
    return item;
  });
  requireDefinition(
    value && !Array.isArray(value) && typeof value === 'object',
    '业务扩展必须是对象',
  );
  return value as T;
}

/**
 * 校验标准流程的连线类别、事件作用域与可执行任务，不把未实现的元素默认为普通节点。
 * @param model - 已成功解析的 BPMN 元模型。
 * @returns 可定位到标准元素标识的校验问题。
 */
export function validateWorkflowBpmn(
  model: WorkflowBpmnModel,
): WorkflowBpmnIssue[] {
  const index = new WorkflowBpmnModelIndex(model);
  const issues: WorkflowBpmnIssue[] = validateBpmnCorrelations(model);
  if (!model.processes.some((process) => process.isExecutable))
    issues.push({ code: 'process', message: '至少需要一个可执行流程' });
  for (const element of index.elements) {
    const validate = elementValidators[element.$type];
    if (!validate) continue;
    validate({
      element,
      index,
      report: (code, message) => {
        issues.push({ code, nodeId: element.id, message });
      },
    });
  }
  return issues;
}

/**
 * 按消息抛出和捕获方向限制事件端点，网关和泳道不参与消息流。
 * @param element - 消息流的候选端点。
 * @param incoming - 是否作为接收方。
 * @param index - 共享的事件定义与图关系索引。
 * @returns 端点满足标准消息方向时返回真。
 */
function isMessageEndpoint(
  element: WorkflowBpmnElement | undefined,
  incoming: boolean,
  index: WorkflowBpmnModelIndex,
): boolean {
  if (!element) return false;
  if (
    element.$type === BPMN_TYPE.Participant ||
    element.$instanceOf(BPMN_TYPE.Activity)
  )
    return true;
  if (!index.events.get(element)?.types.has(BPMN_TYPE.MessageEventDefinition))
    return false;
  if (incoming) return BPMN_KIND_GROUPS.catchEvents.has(element.$type);
  return BPMN_KIND_GROUPS.throwEvents.has(element.$type);
}

type BpmnReporter = (code: string, message: string) => void;
type BpmnValidationContext = {
  element: WorkflowBpmnElement;
  index: WorkflowBpmnModelIndex;
  report: BpmnReporter;
};

const elementValidators: Readonly<
  Record<string, (context: BpmnValidationContext) => void>
> = {
  [BPMN_TYPE.SequenceFlow]: validateSequenceFlow,
  [BPMN_TYPE.MessageFlow]: validateMessageFlow,
  [BPMN_TYPE.EventBasedGateway]: validateEventGateway,
  [BPMN_TYPE.Lane]: validateLane,
  [BPMN_TYPE.Participant]: validateParticipant,
  [BPMN_TYPE.BoundaryEvent]: validateBoundaryEvent,
  [BPMN_TYPE.SubProcess]: validateEventSubprocess,
  [BPMN_TYPE.CancelEventDefinition]: validateCancelEvent,
  [BPMN_TYPE.TerminateEventDefinition]: validateTerminateEvent,
  [BPMN_TYPE.CallActivity]: validateCallActivity,
  [BPMN_TYPE.ServiceTask]: validateTaskImplementation,
  [BPMN_TYPE.BusinessRuleTask]: validateTaskImplementation,
  [BPMN_TYPE.SendTask]: validateTaskImplementation,
  [BPMN_TYPE.ComplexGateway]: validateComplexGateway,
  [BPMN_TYPE.StartEvent]: validateProcessStart,
};

/**
 * 核对顺序流端点、作用域与条件，缺少端点时直接返回该元素的问题。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateSequenceFlow(context: BpmnValidationContext): void {
  const { element, report } = context;

  const source = element.sourceRef as WorkflowBpmnElement,
    target = element.targetRef as WorkflowBpmnElement;
  if (!source || !target) {
    report('flow-reference', '顺序流必须连接两个流程节点');
    return;
  }
  if (source.$parent !== target.$parent || source.$parent !== element.$parent)
    report('flow-scope', '顺序流不能跨越流程或子流程边界');
  if (
    source.$type === BPMN_TYPE.EndEvent ||
    target.$type === BPMN_TYPE.StartEvent ||
    target.$type === BPMN_TYPE.BoundaryEvent
  )
    report('flow-direction', '开始、结束或边界事件的连线方向不合法');
  if (
    !source.$instanceOf(BPMN_TYPE.FlowNode) ||
    !target.$instanceOf(BPMN_TYPE.FlowNode)
  )
    report('flow-kind', '顺序流只能连接活动、事件或网关');
  if (source.isForCompensation || target.isForCompensation)
    report('compensation-flow', '补偿活动不能连接顺序流');
  if (source.triggeredByEvent || target.triggeredByEvent)
    report('event-subprocess-flow', '事件子流程由事件触发，不能连接外部顺序流');
  if (source.$type === BPMN_TYPE.ParallelGateway && element.conditionExpression)
    report('parallel-condition', '并行网关不能使用条件顺序流');
  if (
    element.conditionExpression &&
    source.default !== element &&
    source.$type !== BPMN_TYPE.ComplexGateway
  ) {
    reportBpmnCondition(
      element.conditionExpression,
      {},
      BPMN_CONDITION_ERRORS.flow,
      report,
    );
  }
}

/**
 * 核对消息流两端所属泳池与收发方向，归属查找复用本批索引。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateMessageFlow(context: BpmnValidationContext): void {
  const { element, index, report } = context;

  const sourcePool = index.participant(element.sourceRef),
    targetPool = index.participant(element.targetRef);
  if (!sourcePool || !targetPool || sourcePool === targetPool)
    report('message-scope', '消息流必须连接不同参与者');
  if (
    !isMessageEndpoint(element.sourceRef, false, index) ||
    !isMessageEndpoint(element.targetRef, true, index)
  )
    report('message-kind', '消息流只能连接参与者、活动或方向正确的消息事件');
}

/**
 * 按已索引的出口核对事件竞争，目标的入口和边界信息不再反复扫描全图。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateEventGateway(context: BpmnValidationContext): void {
  const { element, index, report } = context;

  const outgoing = index.outgoing.get(element) ?? [];
  if (outgoing.length < 2)
    report('event-gateway-outgoing', '事件网关至少需要两个出口');
  if (outgoing.some((flow) => flow.conditionExpression))
    report('event-gateway-condition', '事件网关出口不能配置规则条件');
  if (element.instantiate && (index.incoming.get(element)?.length ?? 0) > 0)
    report('event-gateway-instantiate', '用于创建实例的事件网关不能有入口连线');
  if (element.eventGatewayType === 'Parallel' && !element.instantiate)
    report('event-gateway-parallel', '并行事件网关只能用于创建流程实例');
  const targets = outgoing
    .map((flow) => flow.targetRef)
    .filter(Boolean) as WorkflowBpmnElement[];
  let receivesMessage = false;
  let catchesMessage = false;
  for (const target of targets) {
    if (
      (index.incomingSources.get(target)?.size ?? 0) > 1 ||
      !index.incomingSources.get(target)?.has(element)
    )
      report('event-gateway-incoming', '事件网关的目标不能有其他入口连线');
    if (target.$type === BPMN_TYPE.ReceiveTask) {
      receivesMessage = true;
      if (index.boundaryHosts.has(target))
        report(
          'event-gateway-boundary',
          '事件网关后的接收任务不能附着边界事件',
        );
      continue;
    }
    if (target.$type !== BPMN_TYPE.IntermediateCatchEvent) {
      report('event-gateway-target', '事件网关只能连接中间捕获事件或接收任务');
      continue;
    }
    const events = index.events.get(target);
    if (!events?.gatewayAllowed)
      report(
        'event-gateway-trigger',
        '事件网关只接受消息、信号、定时和条件捕获事件',
      );
    if (
      element.eventGatewayType === 'Parallel' &&
      (events?.types.size !== 1 ||
        !events.types.has(BPMN_TYPE.MessageEventDefinition))
    )
      report(
        'event-gateway-parallel-message',
        '并行实例化事件网关只接受消息触发',
      );
    if (events?.types.has(BPMN_TYPE.MessageEventDefinition))
      catchesMessage = true;
  }
  if (receivesMessage && catchesMessage)
    report(
      'event-gateway-mixed-message',
      '同一事件网关不能混用消息捕获事件和接收任务',
    );
}

/**
 * 核对泳道引用的节点是否属于同一流程容器，共享父链采用缓存定位。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateLane(context: BpmnValidationContext): void {
  const { element, index, report } = context;

  const scope = index.scope(element);
  for (const node of element.flowNodeRef ?? [])
    if (!node.$instanceOf(BPMN_TYPE.FlowNode) || node.$parent !== scope)
      report('lane-reference', '泳道只能引用同一流程作用域中的节点');
}

/**
 * 拒绝不存在的流程引用或同一流程重复归属多个泳池。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateParticipant(context: BpmnValidationContext): void {
  const { element, index, report } = context;
  if (element.processRef) {
    if (!element.processRef.$instanceOf(BPMN_TYPE.Process))
      report('pool-reference', '泳池必须引用流程');
    if ((index.participants.get(element.processRef)?.length ?? 0) > 1)
      report('pool-duplicate', '同一流程不能重复归属多个参与者');
  }
}

/**
 * 核对边界附着、触发类型和补偿处理器，处理器关联通过索引读取。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateBoundaryEvent(context: BpmnValidationContext): void {
  const { element, index, report } = context;

  if (
    !element.attachedToRef?.$instanceOf(BPMN_TYPE.Activity) ||
    element.attachedToRef.$parent !== element.$parent
  )
    report('boundary-scope', '边界事件必须附着在同一作用域的活动上');
  if (element.attachedToRef?.triggeredByEvent)
    report('event-subprocess-boundary', '事件子流程不能附着边界事件');
  if (!element.eventDefinitions?.length)
    report('boundary-definition', '边界事件必须声明事件类型');
  if (
    element.cancelActivity === false &&
    element.eventDefinitions?.some((event: WorkflowBpmnElement) =>
      BPMN_KIND_GROUPS.interruptingEvents.has(event.$type),
    )
  )
    report('boundary-interrupt', '错误和事务取消边界事件必须中断活动');
  if (
    element.eventDefinitions?.some(
      (event: WorkflowBpmnElement) =>
        event.$type === BPMN_TYPE.CompensateEventDefinition,
    )
  ) {
    const association = index.associations.get(element)?.[0];
    if (
      !association?.targetRef?.isForCompensation ||
      association.targetRef.$parent !== element.$parent
    )
      report(
        'compensation-handler',
        '补偿边界事件必须通过关联连接同作用域的补偿活动',
      );
  }
}

/**
 * 限制事件子流程的开始事件数量与中断语义，普通子流程不受此约束。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateEventSubprocess(context: BpmnValidationContext): void {
  const { element, report } = context;
  if (element.triggeredByEvent) {
    const starts = (element.flowElements ?? []).filter(
      (child: WorkflowBpmnElement) => child.$type === BPMN_TYPE.StartEvent,
    );
    if (starts.length !== 1)
      report(
        'event-subprocess-start',
        '事件子流程必须包含且只能包含一个开始事件',
      );
    for (const start of starts) {
      const definitions = [
        ...(start.eventDefinitions ?? []),
        ...(start.eventDefinitionRef ?? []),
      ];
      if (!definitions.length)
        report(
          'event-subprocess-trigger',
          '事件子流程的开始事件必须声明触发类型',
        );
      if (
        start.isInterrupting === false &&
        definitions.some(
          (event: WorkflowBpmnElement) =>
            event.$type === BPMN_TYPE.ErrorEventDefinition,
        )
      )
        report('event-subprocess-error', '错误开始事件必须中断所在作用域');
    }
  }
}

/**
 * 限定事务取消事件所属的结束事件或事务边界。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateCancelEvent(context: BpmnValidationContext): void {
  const { element, report } = context;

  const event = element.$parent;
  let valid =
    event?.$type === BPMN_TYPE.EndEvent &&
    event.$parent?.$type === BPMN_TYPE.Transaction;
  if (
    event?.$type === BPMN_TYPE.BoundaryEvent &&
    event.attachedToRef?.$type === BPMN_TYPE.Transaction
  )
    valid = true;
  if (!valid) report('cancel-scope', '取消事件只适用于事务子流程');
}

/**
 * 仅允许结束事件声明终止整个作用域的语义。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateTerminateEvent(context: BpmnValidationContext): void {
  const { element, report } = context;
  if (element.$parent?.$type !== BPMN_TYPE.EndEvent)
    report('terminate-scope', '终止事件只能用作结束事件');
}

/**
 * 用已发布模型内的流程身份索引核对调用活动的目标。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateCallActivity(context: BpmnValidationContext): void {
  const { element, index, report } = context;
  if (!index.processIds.has(element.calledElement))
    report('call-reference', '调用活动必须引用此发布版本内的已声明流程');
}

/**
 * 限制可执行服务类任务使用工作流统一执行端口。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateTaskImplementation(context: BpmnValidationContext): void {
  const { element, report } = context;
  if (element.implementation !== KT_BPMN_STEP)
    report('task-implementation', '任务必须绑定工作流统一执行端口');
}

/**
 * 核对复杂网关入口、默认流和激活表达式，入口计数由本批连线索引建立。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateComplexGateway(context: BpmnValidationContext): void {
  const { element, index, report } = context;

  const incoming = index.incoming.get(element) ?? [],
    outgoing = index.outgoing.get(element) ?? [];
  if (!incoming.length || !outgoing.length)
    report('complex-flow', '复杂网关至少需要一个入口和一个出口');
  if (element.default && element.default.sourceRef !== element)
    report('complex-default', '复杂网关默认路径必须引用自身出口');
  const paths: Record<string, string> = {
    'content.waitingForStart': 'boolean',
  };
  for (const flow of incoming)
    paths[bpmnPath(['content', 'activationCount', flow.id])] = 'number';
  const conditions = [
    element.activationCondition,
    ...outgoing
      .filter((flow) => flow !== element.default && flow.conditionExpression)
      .map((flow) => flow.conditionExpression),
  ];
  for (const condition of conditions) {
    reportBpmnCondition(
      condition,
      paths,
      BPMN_CONDITION_ERRORS.complex,
      report,
    );
  }
}

/**
 * 拒绝用仅限内部作用域的事件启动顶层流程。
 * @param context - 当前元素、共享模型索引与问题收集端口。
 */
function validateProcessStart(context: BpmnValidationContext): void {
  const { element, report } = context;
  if (element.$parent?.$type === BPMN_TYPE.Process) {
    if (
      (element.eventDefinitions || []).some((event: WorkflowBpmnElement) =>
        BPMN_KIND_GROUPS.scopedEvents.has(event.$type),
      )
    )
      report('start-event', '此类事件不能启动顶层流程');
  }
}

/**
 * 将条件格式、解析和返回类型错误统一归入对应元素的问题，不在每种网关内重复抛错。
 * @param condition - 待校验的标准表达式。
 * @param paths - 当前作用域允许的表达式字段类型。
 * @param errors - 条件所属场景的错误码与说明。
 * @param report - 当前元素的问题收集端口。
 */
function reportBpmnCondition(
  condition: WorkflowBpmnElement | undefined,
  paths: Record<string, string>,
  errors: (typeof BPMN_CONDITION_ERRORS)[keyof typeof BPMN_CONDITION_ERRORS],
  report: BpmnReporter,
): void {
  try {
    requireDefinition(
      condition?.$type === BPMN_TYPE.FormalExpression &&
        condition.language === KT_BPMN_EXPRESSION &&
        typeof condition.body === 'string',
      errors.format,
    );
    const type = bpmnConditionType(JSON.parse(condition.body), paths);
    requireDefinition(type === 'boolean' || type === 'unknown', errors.result);
  } catch (error) {
    report(errors.code, String(error));
  }
}
