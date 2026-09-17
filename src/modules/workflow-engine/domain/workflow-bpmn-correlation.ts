import { bpmnPathParts } from './workflow-bpmn-path';
import { requireDefinition } from '@/common/automation/validation';
import {
  BPMN_KIND_GROUPS,
  BPMN_TYPE,
  KT_BPMN_EXPRESSION,
} from '@/modules/workflow-engine/constants/bpmn';
import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';

import { isDeepStrictEqual } from 'node:util';
import {
  type WorkflowBpmnElement,
  type WorkflowBpmnIssue,
  type WorkflowBpmnModel,
} from '../contract/workflow-bpmn.types';
import { evaluateBpmnExpression } from './workflow-bpmn-expression';
import type { BpmnCorrelationValues } from '../contract/workflow-message.types';

/**
 * 遍历实际包含的标准元素，覆盖没有标识的关联表达式，并跳过引用以避免循环。
 * @param root - 当前标准模型的根或容器。
 * @returns 按包含关系展开的元素。
 */
function containedElements(root: WorkflowBpmnElement): WorkflowBpmnElement[] {
  const elements: WorkflowBpmnElement[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    elements.push(current);
    const children: WorkflowBpmnElement[] = [];
    for (const property of current.$descriptor.properties) {
      if (
        property.isReference ||
        property.isVirtual ||
        !Object.hasOwn(current, property.name)
      )
        continue;
      const value = current.get(property.name);
      let values = [value];
      if (Array.isArray(value)) values = value;
      for (const child of values) {
        if (child && typeof child === 'object' && '$type' in child)
          children.push(child as WorkflowBpmnElement);
      }
    }
    for (let index = children.length - 1; index >= 0; index--)
      pending.push(children[index]);
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
function correlationPath(
  expression: WorkflowBpmnElement | undefined,
  message: boolean,
): { path: string } {
  requireDefinition(
    expression?.language === KT_BPMN_EXPRESSION &&
      typeof expression.body === 'string',
    '关联表达式必须使用工作流声明的 JSON 路径语言',
  );
  const parsed = JSON.parse(expression.body);
  requireDefinition(
    parsed &&
      typeof parsed === 'object' &&
      Object.keys(parsed).length === 1 &&
      typeof parsed.path === 'string',
    '关联表达式必须声明唯一字段路径',
  );
  const parts = bpmnPathParts(parsed.path);
  requireDefinition(
    parts.length > 1 && (!message || parts[0] === 'content'),
    '关联表达式字段路径不合法',
  );
  return parsed;
}

/**
 * 在发布前拒绝不完整的关联键、重复提取及不属于键的订阅属性，错误定位到所属元素。
 * @param model - 已恢复引用的结构化标准模型。
 * @returns 可定位的关联模型校验问题。
 * @throws 关联结构非法时在内部抛出并捕获，转换成校验问题而不向调用方传播。
 */
export function validateBpmnCorrelations(
  model: WorkflowBpmnModel,
): WorkflowBpmnIssue[] {
  const issues: WorkflowBpmnIssue[] = [];
  for (const element of containedElements(model.root)) {
    if (!BPMN_KIND_GROUPS.correlationOwners.has(element.$type)) continue;
    try {
      requireDefinition(
        !BPMN_KIND_GROUPS.correlationKeys.has(element.$type) ||
          !FORBIDDEN_OBJECT_KEYS.has(element.id),
        '关联标识不能使用原型属性名称',
      );
      if (element.$type === BPMN_TYPE.Process) {
        const subscriptions: WorkflowBpmnElement[] =
          element.correlationSubscriptions ?? [];
        requireDefinition(
          new Set(subscriptions.map((item) => item.correlationKeyRef?.id))
            .size === subscriptions.length,
          '同一流程不能重复声明同一个关联键的订阅',
        );
      }
      if (element.$type === BPMN_TYPE.CorrelationKey) {
        const properties: WorkflowBpmnElement[] =
          element.correlationPropertyRef ?? [];
        requireDefinition(
          element.id &&
            properties.length &&
            new Set(properties.map((property) => property.id)).size ===
              properties.length,
          '关联键必须有标识和不重复的关联属性',
        );
      }
      if (element.$type === BPMN_TYPE.CorrelationProperty) {
        const retrievals: WorkflowBpmnElement[] =
          element.correlationPropertyRetrievalExpression ?? [];
        requireDefinition(
          retrievals.length &&
            !retrievals.some((item) => !item.messageRef) &&
            new Set(retrievals.map((item) => item.messageRef.id)).size ===
              retrievals.length,
          '关联属性必须按消息声明唯一提取表达式',
        );
        for (const retrieval of retrievals)
          correlationPath(retrieval.messagePath, true);
      }
      if (element.$type === BPMN_TYPE.CorrelationSubscription) {
        const key = element.correlationKeyRef;
        const bindings: WorkflowBpmnElement[] =
          element.correlationPropertyBinding ?? [];
        const properties: WorkflowBpmnElement[] =
          key?.correlationPropertyRef ?? [];
        requireDefinition(
          key &&
            bindings.length === properties.length &&
            new Set(
              bindings.map((binding) => binding.correlationPropertyRef?.id),
            ).size === properties.length,
          '关联订阅必须完整绑定关联键的全部属性',
        );
        const allowedProperties = new Set(properties);
        for (const binding of bindings) {
          requireDefinition(
            allowedProperties.has(binding.correlationPropertyRef),
            '关联订阅包含不属于当前键的属性',
          );
          correlationPath(binding.dataPath, false);
        }
      }
    } catch (error) {
      issues.push({
        code: 'message-correlation',
        nodeId: element.id ?? element.$parent?.id,
        message: (error as Error).message,
      });
    }
  }
  return issues;
}

/**
 * 找到消息节点所属流程，调用活动的被调用流程保留自己的关联范围。
 * @param element - 消息捕获节点。
 * @returns 最近的标准流程；未归属流程时为空。
 */
export function bpmnMessageProcess(
  element: WorkflowBpmnElement,
): WorkflowBpmnElement | undefined {
  let parent = element;
  while (parent && parent.$type !== BPMN_TYPE.Process) parent = parent.$parent;
  return parent;
}

const correlationIndexes = new WeakMap<
  WorkflowBpmnModel,
  WorkflowBpmnCorrelationIndex
>();

class WorkflowBpmnCorrelationIndex {
  readonly subscriptions = new Map<
    WorkflowBpmnElement,
    Map<WorkflowBpmnElement, WorkflowBpmnElement>
  >();
  readonly retrievals = new Map<
    WorkflowBpmnElement,
    Map<string, WorkflowBpmnElement>
  >();
  private readonly owners = new Map<
    WorkflowBpmnElement,
    Map<string | null, Set<WorkflowBpmnElement>>
  >();

  constructor(model: WorkflowBpmnModel) {
    for (const process of model.processes) {
      const subscriptions = new Map<WorkflowBpmnElement, WorkflowBpmnElement>();
      for (const subscription of process.correlationSubscriptions ?? [])
        subscriptions.set(subscription.correlationKeyRef, subscription);
      this.subscriptions.set(process, subscriptions);
    }
    for (const element of Object.values(model.elements)) {
      if (element.$type !== BPMN_TYPE.CorrelationProperty) continue;
      const retrievals = new Map<string, WorkflowBpmnElement>();
      for (const expression of element.correlationPropertyRetrievalExpression ??
        []) {
        if (!retrievals.has(expression.messageRef?.id))
          retrievals.set(expression.messageRef?.id, expression);
      }
      this.retrievals.set(element, retrievals);
    }
    for (const collaboration of model.root.rootElements ?? []) {
      if (collaboration.$type === BPMN_TYPE.Collaboration)
        this.indexCollaboration(collaboration);
    }
  }

  /**
   * 按消息接收端点分组关联拥有者，共用会话保留引用，避免把同一键目录复制到每条连线。
   * @param collaboration - 当前协作及其参与者、消息流和会话。
   */
  private indexCollaboration(collaboration: WorkflowBpmnElement): void {
    const participants = new Map<WorkflowBpmnElement, WorkflowBpmnElement>();
    for (const participant of collaboration.participants ?? []) {
      if (!participants.has(participant.processRef))
        participants.set(participant.processRef, participant);
    }
    const targets = new Map<WorkflowBpmnElement, WorkflowBpmnElement>();
    for (const flow of collaboration.messageFlows ?? []) {
      let target = flow.targetRef;
      let process = bpmnMessageProcess(target);
      if (target?.$type === BPMN_TYPE.Participant) {
        process = target.processRef;
        if (participants.get(process) !== target) continue;
        target = process;
      }
      if (!target || !participants.has(process)) continue;
      targets.set(flow, target);
      this.addOwner(target, flow.messageRef?.id ?? null, collaboration);
    }
    for (const conversation of containedElements(collaboration)) {
      if (!conversation.messageFlowRefs?.length) continue;
      const owners: WorkflowBpmnElement[] = [];
      let parent = conversation;
      while (parent && parent !== collaboration) {
        if (parent.correlationKeys?.length) owners.push(parent);
        parent = parent.$parent;
      }
      for (const flow of conversation.messageFlowRefs) {
        const target = targets.get(flow);
        if (!target) continue;
        for (const owner of owners)
          this.addOwner(target, flow.messageRef?.id ?? null, owner);
      }
    }
  }

  /**
   * 将拥有者登记到精确消息及端点，重复消息流不会重复展开同一会话的键。
   * @param target - 流程参与者对应流程或具体接收节点。
   * @param messageId - 固定消息身份，空值表示适用任意消息。
   * @param owner - 保存关联键的协作或会话。
   */
  private addOwner(
    target: WorkflowBpmnElement,
    messageId: string | null,
    owner: WorkflowBpmnElement,
  ): void {
    const messages = this.owners.get(target) ?? new Map();
    const owners = messages.get(messageId) ?? new Set();
    owners.add(owner);
    messages.set(messageId, owners);
    this.owners.set(target, messages);
  }

  /**
   * 合并流程订阅、节点及泳池接收消息的键，每个匹配拥有者只展开一次。
   * @param node - 固定接收节点。
   * @param process - 接收节点所属流程。
   * @param messageId - 当前投递的消息身份。
   * @returns 本接收位置适用的不重复关联键。
   */
  keys(
    node: WorkflowBpmnElement,
    process: WorkflowBpmnElement,
    messageId: string | null,
  ): WorkflowBpmnElement[] {
    const keys = new Set(this.subscriptions.get(process)?.keys());
    const owners = new Set<WorkflowBpmnElement>();
    for (const target of [node, process]) {
      const messages = this.owners.get(target);
      for (const identity of [messageId, null]) {
        for (const owner of messages?.get(identity) ?? []) owners.add(owner);
      }
    }
    for (const owner of owners)
      for (const key of owner.correlationKeys ?? []) keys.add(key);
    return [...keys];
  }
}

/**
 * 同一固定版本模型的多个候选接收位置共用一次关联索引，模型释放后索引随之回收。
 * @param model - 恢复后不再编辑的固定发布模型。
 * @returns 该模型的端点、订阅及提取路径索引。
 */
function correlationIndex(
  model: WorkflowBpmnModel,
): WorkflowBpmnCorrelationIndex {
  let index = correlationIndexes.get(model);
  if (!index) {
    index = new WorkflowBpmnCorrelationIndex(model);
    correlationIndexes.set(model, index);
  }
  return index;
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
  model: WorkflowBpmnModel,
  nodeId: string,
  messageId: string | null,
  values: Record<string, unknown>,
  context: Record<string, unknown>,
  previous: BpmnCorrelationValues,
  requireMatch = false,
): BpmnCorrelationValues {
  const index = correlationIndex(model);
  const process = bpmnMessageProcess(model.elements[nodeId]);
  const keys = index.keys(model.elements[nodeId], process, messageId);
  if (!keys.length) {
    requireDefinition(!requireMatch, '当前消息未声明可用于查找实例的关联键');
    return structuredClone(previous);
  }
  const result = structuredClone(previous);
  let extracted = 0;
  let matched = false;
  const subscriptions = index.subscriptions.get(process);
  const extractedProperties = new Map<WorkflowBpmnElement, unknown>();
  for (const key of keys) {
    const received: Record<string, unknown> = {};
    const properties: WorkflowBpmnElement[] = key.correlationPropertyRef ?? [];
    requireDefinition(properties.length, '关联键没有可提取的属性');
    let complete = true;
    for (const property of properties) {
      if (!extractedProperties.has(property)) {
        const retrieval = index.retrievals.get(property)?.get(messageId);
        let value: unknown;
        if (retrieval)
          value = evaluateBpmnExpression(
            correlationPath(retrieval.messagePath, true),
            { content: values },
          );
        extractedProperties.set(property, value);
      }
      const value = extractedProperties.get(property);
      if (value === undefined || value === null) {
        complete = false;
        break;
      }
      received[property.id] = value;
    }
    if (!complete) continue;
    extracted += 1;
    const subscription = subscriptions?.get(key);
    let expected = result[key.id];
    if (subscription) {
      expected = {};
      for (const binding of subscription.correlationPropertyBinding ?? []) {
        const value = evaluateBpmnExpression(
          correlationPath(binding.dataPath, false),
          context,
        );
        requireDefinition(
          value !== undefined && value !== null,
          '流程订阅的关联字段尚未初始化',
        );
        expected[binding.correlationPropertyRef.id] = value;
      }
    }
    if (expected !== undefined) {
      requireDefinition(
        isDeepStrictEqual(expected, received),
        '消息关联键与当前流程不一致',
      );
      matched = true;
    }
    result[key.id] = structuredClone(received);
  }
  requireDefinition(
    extracted && (!requireMatch || matched),
    '消息没有完整且匹配的关联键',
  );
  return result;
}
