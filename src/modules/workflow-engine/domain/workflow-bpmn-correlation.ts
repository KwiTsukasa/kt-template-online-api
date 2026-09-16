import { isDeepStrictEqual } from 'node:util';
import { KT_BPMN_EXPRESSION, type WorkflowBpmnElement, type WorkflowBpmnIssue, type WorkflowBpmnModel } from '../contract/workflow-bpmn.types';
import { evaluateBpmnExpression } from './workflow-bpmn-expression';
import type { BpmnCorrelationValues } from '../contract/workflow-message.types';

/**
 * 遍历实际包含的标准元素，覆盖没有标识的关联表达式，并跳过引用以避免循环。
 * @param root - 当前标准模型的根或容器。
 * @returns 按包含关系展开的元素。
 */
function containedElements(root: WorkflowBpmnElement): WorkflowBpmnElement[] {
  const elements = [root];
  for (const property of root.$descriptor.properties) {
    if (property.isReference || property.isVirtual || !Object.hasOwn(root, property.name)) continue;
    const value = root.get(property.name);
    let children = [value];
    if (Array.isArray(value)) children = value;
    for (const child of children) {
      if (child && typeof child === 'object' && '$type' in child) elements.push(...containedElements(child as WorkflowBpmnElement));
    }
  }
  return elements;
}

/**
 * 校验关联表达式的语言及消息或流程取值路径，避免任意代码或跨上下文读取。
 * @param expression - 标准消息提取或流程订阅表达式。
 * @param message - 是否限定为消息正文路径。
 * @returns 已解析且仅含路径的表达式。
 * @throws 缺少表达式、语言不匹配或路径不合法时拒绝执行。
 */
function correlationPath(expression: WorkflowBpmnElement | undefined, message: boolean): { path: string } {
  if (expression?.language !== KT_BPMN_EXPRESSION || typeof expression.body !== 'string') throw new Error('关联表达式必须使用工作流声明的 JSON 路径语言');
  const parsed = JSON.parse(expression.body);
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== 1 || typeof parsed.path !== 'string') throw new Error('关联表达式必须声明唯一字段路径');
  let pattern = /^(input|outputs|variables|content)(\.[A-Za-z0-9_-]+)+$/;
  if (message) pattern = /^content(\.[A-Za-z0-9_-]+)+$/;
  if (!pattern.test(parsed.path) || parsed.path.split('.').some((part: string) => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('关联表达式字段路径不合法');
  return parsed;
}

/**
 * 在发布前拒绝不完整的关联键、重复提取及不属于键的订阅属性，错误定位到所属元素。
 * @param model - 已恢复引用的结构化标准模型。
 * @returns 可定位的关联模型校验问题。
 * @throws 关联结构非法时在内部抛出并捕获，转换成校验问题而不向调用方传播。
 */
export function validateBpmnCorrelations(model: WorkflowBpmnModel): WorkflowBpmnIssue[] {
  const issues: WorkflowBpmnIssue[] = [];
  for (const element of containedElements(model.root)) {
    if (!['bpmn:Process', 'bpmn:CorrelationKey', 'bpmn:CorrelationProperty', 'bpmn:CorrelationSubscription'].includes(element.$type)) continue;
    try {
      if (['bpmn:CorrelationKey', 'bpmn:CorrelationProperty'].includes(element.$type) && ['__proto__', 'constructor', 'prototype'].includes(element.id)) throw new Error('关联标识不能使用原型属性名称');
      if (element.$type === 'bpmn:Process') {
        const subscriptions: WorkflowBpmnElement[] = element.correlationSubscriptions ?? [];
        if (new Set(subscriptions.map((item) => item.correlationKeyRef?.id)).size !== subscriptions.length) throw new Error('同一流程不能重复声明同一个关联键的订阅');
      }
      if (element.$type === 'bpmn:CorrelationKey') {
        const properties: WorkflowBpmnElement[] = element.correlationPropertyRef ?? [];
        if (!element.id || !properties.length || new Set(properties.map((property) => property.id)).size !== properties.length) throw new Error('关联键必须有标识和不重复的关联属性');
      }
      if (element.$type === 'bpmn:CorrelationProperty') {
        const retrievals: WorkflowBpmnElement[] = element.correlationPropertyRetrievalExpression ?? [];
        if (!retrievals.length || retrievals.some((item) => !item.messageRef) || new Set(retrievals.map((item) => item.messageRef.id)).size !== retrievals.length) throw new Error('关联属性必须按消息声明唯一提取表达式');
        for (const retrieval of retrievals) correlationPath(retrieval.messagePath, true);
      }
      if (element.$type === 'bpmn:CorrelationSubscription') {
        const key = element.correlationKeyRef;
        const bindings: WorkflowBpmnElement[] = element.correlationPropertyBinding ?? [];
        const properties: WorkflowBpmnElement[] = key?.correlationPropertyRef ?? [];
        if (!key || bindings.length !== properties.length || new Set(bindings.map((binding) => binding.correlationPropertyRef?.id)).size !== properties.length) throw new Error('关联订阅必须完整绑定关联键的全部属性');
        for (const binding of bindings) {
          if (!properties.includes(binding.correlationPropertyRef)) throw new Error('关联订阅包含不属于当前键的属性');
          correlationPath(binding.dataPath, false);
        }
      }
    } catch (error) {
      issues.push({ code: 'message-correlation', nodeId: element.id ?? element.$parent?.id, message: (error as Error).message });
    }
  }
  return issues;
}

/**
 * 找到消息节点所属流程，调用活动的被调用流程保留自己的关联范围。
 * @param element - 消息捕获节点。
 * @returns 最近的标准流程；未归属流程时为空。
 */
export function bpmnMessageProcess(element: WorkflowBpmnElement): WorkflowBpmnElement | undefined {
  let parent = element;
  while (parent && parent.$type !== 'bpmn:Process') parent = parent.$parent;
  return parent;
}

/**
 * 从流程订阅及消息流所在协作、会话取得适用的标准关联键。
 * @param model - 已解析的标准模型。
 * @param nodeId - 接收消息的节点。
 * @param messageId - 消息声明身份。
 * @returns 适用于该接收位置的不重复关联键。
 */
function applicableKeys(model: WorkflowBpmnModel, nodeId: string, messageId: string | null): WorkflowBpmnElement[] {
  const process = bpmnMessageProcess(model.elements[nodeId]);
  const keys = new Set<WorkflowBpmnElement>();
  for (const subscription of process?.correlationSubscriptions ?? []) if (subscription.correlationKeyRef) keys.add(subscription.correlationKeyRef);
  for (const collaboration of model.root.rootElements ?? []) {
    if (collaboration.$type !== 'bpmn:Collaboration') continue;
    const participant = (collaboration.participants ?? []).find((item: WorkflowBpmnElement) => item.processRef === process);
    if (!participant) continue;
    const flows = (collaboration.messageFlows ?? []).filter((flow: WorkflowBpmnElement) => {
      if (flow.messageRef && flow.messageRef.id !== messageId) return false;
      return flow.targetRef?.id === nodeId || flow.targetRef === participant;
    });
    if (!flows.length) continue;
    for (const key of collaboration.correlationKeys ?? []) keys.add(key);
    for (const conversation of containedElements(collaboration)) {
      if (!(conversation.messageFlowRefs ?? []).some((flow: WorkflowBpmnElement) => flows.includes(flow))) continue;
      let container = conversation;
      while (container && container !== collaboration) {
        for (const key of container.correlationKeys ?? []) keys.add(key);
        container = container.$parent;
      }
    }
  }
  return [...keys];
}

/**
 * 按模型提取复合关联键，保留既有键并学习新键；流程订阅按当前业务上下文重新计算。
 * @param model - 固定发布版本的标准模型。
 * @param nodeId - 将接收消息的标准节点。
 * @param messageId - 当前消息声明标识。
 * @param values - 已核验为 JSON 的消息正文。
 * @param context - 当前流程输入、结果和变量快照。
 * @param previous - 同一流程执行作用域已经确认的关联值。
 * @param requireMatch - 跨实例查找时必须至少匹配一个既有关联键，不能只用新键认领实例。
 * @returns 该消息匹配后的关联键快照；无关联声明时保持原值。
 * @throws 关联字段未完整提取、既有键冲突或无法唯一证明已有会话归属时拒绝消息。
 */
export function correlateBpmnMessage(
  model: WorkflowBpmnModel, nodeId: string, messageId: string | null,
  values: Record<string, unknown>, context: Record<string, unknown>, previous: BpmnCorrelationValues,
  requireMatch = false,
): BpmnCorrelationValues {
  const keys = applicableKeys(model, nodeId, messageId);
  if (!keys.length) {
    if (requireMatch) throw new Error('当前消息未声明可用于查找实例的关联键');
    return structuredClone(previous);
  }
  const result = structuredClone(previous);
  let extracted = 0;
  let matched = false;
  for (const key of keys) {
    const received: Record<string, unknown> = {};
    const properties: WorkflowBpmnElement[] = key.correlationPropertyRef ?? [];
    if (!properties.length) throw new Error('关联键没有可提取的属性');
    let complete = true;
    for (const property of properties) {
      const retrieval = (property.correlationPropertyRetrievalExpression ?? []).find((item: WorkflowBpmnElement) => item.messageRef.id === messageId);
      if (!retrieval) { complete = false; break; }
      const value = evaluateBpmnExpression(correlationPath(retrieval.messagePath, true), { content: values });
      if (value === undefined || value === null) { complete = false; break; }
      received[property.id] = value;
    }
    if (!complete) continue;
    extracted += 1;
    const process = bpmnMessageProcess(model.elements[nodeId]);
    const subscription = (process?.correlationSubscriptions ?? []).find((item: WorkflowBpmnElement) => item.correlationKeyRef === key);
    let expected = result[key.id];
    if (subscription) {
      expected = {};
      for (const binding of subscription.correlationPropertyBinding ?? []) {
        const value = evaluateBpmnExpression(correlationPath(binding.dataPath, false), context);
        if (value === undefined || value === null) throw new Error('流程订阅的关联字段尚未初始化');
        expected[binding.correlationPropertyRef.id] = value;
      }
    }
    if (expected !== undefined) {
      if (!isDeepStrictEqual(expected, received)) throw new Error('消息关联键与当前流程不一致');
      matched = true;
    }
    result[key.id] = structuredClone(received);
  }
  if (!extracted || (requireMatch && !matched)) throw new Error('消息没有完整且匹配的关联键');
  return result;
}
