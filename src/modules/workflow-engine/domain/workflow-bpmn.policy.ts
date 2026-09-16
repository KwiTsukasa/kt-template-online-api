/// <reference types="../contract/bpmn-moddle" />
import * as BpmnModdle from 'bpmn-moddle';
import {
  BPMN_FORMAT,
  KT_BPMN_MODDLE,
  KT_BPMN_STEP,
  type WorkflowBpmnDefinition,
  type WorkflowBpmnElement,
  type WorkflowBpmnIssue,
  type WorkflowBpmnModel,
} from '../contract/workflow-bpmn.types';
import { dehydrateWorkflowBpmn, hydrateWorkflowBpmn } from './workflow-bpmn-model';
import { validateBpmnCorrelations } from './workflow-bpmn-correlation';

/**
 * 从内部结构化模型恢复完整 BPMN 元模型，不生成 XML。
 * @param input - 带格式标记的结构化 BPMN 定义。
 * @returns 保留标准属性、DI 与命名空间扩展的模型。
 * @throws 格式、长度、标准元素或引用不合法时拒绝接收。
 */
export async function parseWorkflowBpmn(input: unknown): Promise<WorkflowBpmnModel> {
  return hydrateWorkflowBpmn(input);
}

/**
 * 将外部 BPMN XML 导入为内部结构化模型；解析后不持久化 XML 文本。
 * @param xml - 显式导入的标准 XML 内容。
 * @returns 与编辑和执行共用的结构化 BPMN 定义。
 * @throws XML、实体声明或无法保留的标准元素不合法时拒绝导入。
 */
export async function importWorkflowBpmnXml(xml: string): Promise<WorkflowBpmnDefinition> {
  if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml, 'utf8') > 2 * 1024 * 1024)
    throw new Error('BPMN XML 不能为空且不能超过 2 MiB');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
    throw new Error('BPMN XML 不允许 DTD 或实体声明');
  const moddle = new BpmnModdle({ kt: KT_BPMN_MODDLE });
  const parsed = await moddle.fromXML(xml);
  if (parsed.warnings.length)
    throw new Error(`BPMN XML 包含未解析内容：${parsed.warnings.map((item) => item.message).join('；')}`);
  if (parsed.rootElement.$type !== 'bpmn:Definitions') throw new Error('BPMN XML 根节点必须是 definitions');
  return hydrateWorkflowBpmn({ format: BPMN_FORMAT, model: dehydrateWorkflowBpmn(parsed.rootElement as WorkflowBpmnElement) }).definition;
}

/**
 * 将修改后的元模型写回结构化定义，编辑保存不进行 XML 序列化。
 * @param root - 编辑器拥有的 BPMN definitions 元素。
 * @returns 经引用与类型校验的结构化定义。
 * @throws 导出后模型无法完整解析时拒绝保存。
 */
export async function serializeWorkflowBpmn(root: WorkflowBpmnElement): Promise<WorkflowBpmnDefinition> {
  return hydrateWorkflowBpmn({ format: BPMN_FORMAT, model: dehydrateWorkflowBpmn(root) }).definition;
}

/**
 * 仅在显式导出时把当前标准模型和 DI 转换成 BPMN XML 文件内容。
 * @param definition - 当前草稿或固定版本的结构化模型。
 * @returns 可下载为 .bpmn 文件的标准 XML 内容。
 * @throws 内部模型或引用不合法时拒绝导出。
 */
export async function exportWorkflowBpmnXml(definition: WorkflowBpmnDefinition): Promise<string> {
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
export function readWorkflowBpmnExtension<T>(element: WorkflowBpmnElement, type: 'kt:Contract' | 'kt:Step'): T | null {
  const entries: WorkflowBpmnElement[] = (element.extensionElements?.values || []).filter((value: WorkflowBpmnElement) => value.$type === type);
  if (!entries.length) return null;
  if (entries.length !== 1) throw new Error(`${element.id} 只能有一个 ${type} 扩展`);
  const value = JSON.parse(entries[0].body, (key, item) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('业务扩展包含不允许的属性');
    return item;
  });
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('业务扩展必须是对象');
  return value as T;
}

/**
 * 校验标准流程的连线类别、事件作用域与可执行任务，不把未实现的元素默认为普通节点。
 * @param model - 已成功解析的 BPMN 元模型。
 * @returns 可定位到标准元素标识的校验问题。
 */
export function validateWorkflowBpmn(model: WorkflowBpmnModel): WorkflowBpmnIssue[] {
  const issues: WorkflowBpmnIssue[] = validateBpmnCorrelations(model);
  const elements = Object.values(model.elements);
  const flows = elements.filter((element) => element.$type === 'bpmn:SequenceFlow');
  if (!model.processes.some((process) => process.isExecutable)) issues.push({ code: 'process', message: '至少需要一个可执行流程' });
  for (const element of Object.values(model.elements)) {
    const report = (code: string, message: string) => issues.push({ code, nodeId: element.id, message });
    if (element.$type === 'bpmn:SequenceFlow') {
      const source = element.sourceRef as WorkflowBpmnElement, target = element.targetRef as WorkflowBpmnElement;
      if (!source || !target) report('flow-reference', '顺序流必须连接两个流程节点');
      else {
        if (source.$parent !== target.$parent || source.$parent !== element.$parent) report('flow-scope', '顺序流不能跨越流程或子流程边界');
        if (source.$type === 'bpmn:EndEvent' || target.$type === 'bpmn:StartEvent' || target.$type === 'bpmn:BoundaryEvent') report('flow-direction', '开始、结束或边界事件的连线方向不合法');
        if (!source.$instanceOf('bpmn:FlowNode') || !target.$instanceOf('bpmn:FlowNode')) report('flow-kind', '顺序流只能连接活动、事件或网关');
        if (source.isForCompensation || target.isForCompensation) report('compensation-flow', '补偿活动不能连接顺序流');
        if (source.$type === 'bpmn:ParallelGateway' && element.conditionExpression) report('parallel-condition', '并行网关不能使用条件顺序流');
      }
    }
    if (element.$type === 'bpmn:MessageFlow') {
      const sourcePool = bpmnParticipant(model, element.sourceRef), targetPool = bpmnParticipant(model, element.targetRef);
      if (!sourcePool || !targetPool || sourcePool === targetPool) report('message-scope', '消息流必须连接不同参与者');
      if (!isMessageEndpoint(element.sourceRef, false) || !isMessageEndpoint(element.targetRef, true)) report('message-kind', '消息流只能连接参与者、活动或方向正确的消息事件');
    }
    if (element.$type === 'bpmn:EventBasedGateway') {
      const outgoing = flows.filter((flow) => flow.sourceRef === element);
      if (outgoing.length < 2) report('event-gateway-outgoing', '事件网关至少需要两个出口');
      if (outgoing.some((flow) => flow.conditionExpression)) report('event-gateway-condition', '事件网关出口不能配置规则条件');
      if (element.instantiate && flows.some((flow) => flow.targetRef === element)) report('event-gateway-instantiate', '用于创建实例的事件网关不能有入口连线');
      if (element.eventGatewayType === 'Parallel' && !element.instantiate) report('event-gateway-parallel', '并行事件网关只能用于创建流程实例');
      const targets = outgoing.map((flow) => flow.targetRef).filter(Boolean) as WorkflowBpmnElement[];
      let receivesMessage = false;
      let catchesMessage = false;
      for (const target of targets) {
        if (flows.some((flow) => flow.targetRef === target && flow.sourceRef !== element)) report('event-gateway-incoming', '事件网关的目标不能有其他入口连线');
        if (target.$type === 'bpmn:ReceiveTask') {
          receivesMessage = true;
          if (elements.some((event) => event.$type === 'bpmn:BoundaryEvent' && event.attachedToRef === target)) report('event-gateway-boundary', '事件网关后的接收任务不能附着边界事件');
          continue;
        }
        if (target.$type !== 'bpmn:IntermediateCatchEvent') {
          report('event-gateway-target', '事件网关只能连接中间捕获事件或接收任务');
          continue;
        }
        const definitions: WorkflowBpmnElement[] = [...(target.eventDefinitions ?? []), ...(target.eventDefinitionRef ?? [])];
        if (!definitions.length || definitions.some((event) => !['bpmn:MessageEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:ConditionalEventDefinition'].includes(event.$type))) report('event-gateway-trigger', '事件网关只接受消息、信号、定时和条件捕获事件');
        if (element.eventGatewayType === 'Parallel' && definitions.some((event) => event.$type !== 'bpmn:MessageEventDefinition')) report('event-gateway-parallel-message', '并行实例化事件网关只接受消息触发');
        if (definitions.some((event) => event.$type === 'bpmn:MessageEventDefinition')) catchesMessage = true;
      }
      if (receivesMessage && catchesMessage) report('event-gateway-mixed-message', '同一事件网关不能混用消息捕获事件和接收任务');
    }
    if (element.$type === 'bpmn:Lane') {
      let scope = element.$parent;
      while (scope && !scope.$instanceOf('bpmn:FlowElementsContainer')) scope = scope.$parent;
      for (const node of element.flowNodeRef ?? []) if (!node.$instanceOf('bpmn:FlowNode') || node.$parent !== scope) report('lane-reference', '泳道只能引用同一流程作用域中的节点');
    }
    if (element.$type === 'bpmn:Participant' && element.processRef) {
      if (!element.processRef.$instanceOf('bpmn:Process')) report('pool-reference', '泳池必须引用流程');
      if (Object.values(model.elements).some((other) => other !== element && other.$type === 'bpmn:Participant' && other.processRef === element.processRef)) report('pool-duplicate', '同一流程不能重复归属多个参与者');
    }
    if (element.$type === 'bpmn:BoundaryEvent') {
      if (!element.attachedToRef?.$instanceOf('bpmn:Activity') || element.attachedToRef.$parent !== element.$parent) report('boundary-scope', '边界事件必须附着在同一作用域的活动上');
      if (!element.eventDefinitions?.length) report('boundary-definition', '边界事件必须声明事件类型');
      if (element.cancelActivity === false && element.eventDefinitions?.some((event: WorkflowBpmnElement) => ['bpmn:ErrorEventDefinition', 'bpmn:CancelEventDefinition'].includes(event.$type))) report('boundary-interrupt', '错误和事务取消边界事件必须中断活动');
      if (element.eventDefinitions?.some((event: WorkflowBpmnElement) => event.$type === 'bpmn:CompensateEventDefinition')) {
        const association = Object.values(model.elements).find((item) => item.$type === 'bpmn:Association' && item.sourceRef === element);
        if (!association?.targetRef?.isForCompensation || association.targetRef.$parent !== element.$parent) report('compensation-handler', '补偿边界事件必须通过关联连接同作用域的补偿活动');
      }
    }
    if (element.$type === 'bpmn:CancelEventDefinition') {
      const event = element.$parent;
      let valid = event?.$type === 'bpmn:EndEvent' && event.$parent?.$type === 'bpmn:Transaction';
      if (event?.$type === 'bpmn:BoundaryEvent' && event.attachedToRef?.$type === 'bpmn:Transaction') valid = true;
      if (!valid) report('cancel-scope', '取消事件只适用于事务子流程');
    }
    if (element.$type === 'bpmn:TerminateEventDefinition' && element.$parent?.$type !== 'bpmn:EndEvent') report('terminate-scope', '终止事件只能用作结束事件');
    if (element.$type === 'bpmn:CallActivity' && !model.processes.some((process) => process.id === element.calledElement)) report('call-reference', '调用活动必须引用此发布版本内的已声明流程');
    if (['bpmn:ServiceTask', 'bpmn:BusinessRuleTask', 'bpmn:SendTask'].includes(element.$type) && element.implementation !== KT_BPMN_STEP) report('task-implementation', '任务必须绑定工作流统一执行端口');
    if (element.$type === 'bpmn:ComplexGateway') report('unsupported', '复杂网关尚未通过执行符合性验收，不能发布');
    if (element.$type === 'bpmn:StartEvent' && element.$parent?.$type === 'bpmn:Process') {
      if ((element.eventDefinitions || []).some((event: WorkflowBpmnElement) => ['bpmn:ErrorEventDefinition', 'bpmn:CancelEventDefinition', 'bpmn:CompensateEventDefinition'].includes(event.$type))) report('start-event', '此类事件不能启动顶层流程');
    }
  }
  return issues;
}

/**
 * 从节点所属流程定位协作参与者，泳道不会形成独立消息边界。
 * @param model - 带有协作定义的完整模型。
 * @param element - 消息流源或目标。
 * @returns 对应参与者；节点没有参与者时为空。
 */
function bpmnParticipant(model: WorkflowBpmnModel, element?: WorkflowBpmnElement): WorkflowBpmnElement | undefined {
  if (!element) return undefined;
  if (element.$type === 'bpmn:Participant') return element;
  let process = element;
  while (process && process.$type !== 'bpmn:Process') process = process.$parent;
  return Object.values(model.elements).find((candidate) => candidate.$type === 'bpmn:Participant' && candidate.processRef === process);
}

/**
 * 按消息抛出和捕获方向限制事件端点，网关和泳道不参与消息流。
 * @param element - 消息流的候选端点。
 * @param incoming - 是否作为接收方。
 * @returns 端点满足标准消息方向时返回真。
 */
function isMessageEndpoint(element: WorkflowBpmnElement | undefined, incoming: boolean): boolean {
  if (!element) return false;
  if (element.$type === 'bpmn:Participant' || element.$instanceOf('bpmn:Activity')) return true;
  if (!element.eventDefinitions?.some((event: WorkflowBpmnElement) => event.$type === 'bpmn:MessageEventDefinition')) return false;
  if (incoming) return ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'].includes(element.$type);
  return ['bpmn:EndEvent', 'bpmn:IntermediateThrowEvent'].includes(element.$type);
}
