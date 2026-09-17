import { requireDefinition } from '@/common/automation/validation';
import {
  BPMN_KIND_GROUPS,
  BPMN_TYPE,
} from '@/modules/workflow-engine/constants/bpmn';
import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';
import { automationDigest } from '@/common/automation/content-digest';
import { orderJsonKeys } from '@/common/automation/json-key-order';
import { RUN_STATUS } from '@/common/automation/constants/run-status';

import { definitionRecord } from '@/common/automation/definition.types';
import type {
  WorkflowBpmnElement,
  WorkflowBpmnModel,
} from '../contract/workflow-bpmn.types';
import { WorkflowBpmnModelIndex } from './workflow-bpmn-index';
import type {
  WorkflowBusinessMessage,
  WorkflowMessageIngress,
  WorkflowMessageRecord,
} from '../contract/workflow-message.types';
import type { WorkflowBpmnRunState } from '../infrastructure/persistence/workflow-bpmn.entity';
import {
  advanceWorkflowBpmn,
  type WorkflowBpmnActiveActivity,
} from '../infrastructure/workflow-bpmn.runtime';
import { correlateBpmnMessage } from './workflow-bpmn-correlation';

/**
 * 固定消息字段排序并拒绝原型、非 JSON 数值及过深对象，使重试内容比较不受键顺序影响。
 * @param value - 待保存的消息字段或嵌套值。
 * @param depth - 当前嵌套深度。
 * @returns 可稳定序列化的 JSON 值。
 * @throws 不支持的类型、危险属性或超过十六层嵌套时拒绝消息。
 */
export function normalizeMessageValue(value: unknown, depth = 0): unknown {
  requireDefinition(depth <= 16, '消息字段不能超过十六层嵌套');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item) => normalizeMessageValue(item, depth + 1));
  const record = definitionRecord(value);
  const result: Record<string, unknown> = {};
  for (const key of orderJsonKeys(Object.keys(record))) {
    requireDefinition(
      !FORBIDDEN_OBJECT_KEYS.has(key),
      '消息字段不允许原型属性',
    );
    result[key] = normalizeMessageValue(record[key], depth + 1);
  }
  return result;
}

/**
 * 将鉴权后的业务范围与发送方密封为投递身份，不允许调用方提供运行或节点标识。
 * @param message - 业务接收的消息类型、稳定投递键和正文。
 * @param identity - 已确认的业务接口、范围与对象身份。
 * @returns 规范化正文及跨流程版本稳定的幂等摘要。
 * @throws 消息身份或正文格式、大小不符合约束时拒绝接收。
 */
export function businessMessageIngress(
  message: WorkflowBusinessMessage,
  identity: unknown[],
): WorkflowMessageIngress {
  const envelope = definitionRecord(message);
  for (const key of ['deliveryId', 'messageId', 'senderId']) {
    requireDefinition(
      typeof envelope[key] === 'string' &&
        envelope[key].trim() &&
        envelope[key].length <= 191,
      '消息身份需要 1 至 191 个字符',
    );
  }
  const values = normalizeMessageValue(
    definitionRecord(message.values),
  ) as Record<string, unknown>;
  const serialized = JSON.stringify([
    message.messageId,
    message.senderId,
    values,
  ]);
  requireDefinition(
    Buffer.byteLength(serialized) <= 64 * 1024,
    '单条工作流消息不能超过 64 KiB',
  );
  return {
    deliveryId: message.deliveryId,
    messageId: message.messageId,
    senderId: message.senderId,
    values,
    ingressKey: automationDigest(
      JSON.stringify([...identity, message.senderId, message.deliveryId]),
    ),
    ingressHash: automationDigest(serialized),
  };
}

/**
 * 按实际等待事件定义读取消息类型，区分匿名消息等待和非消息节点。
 * @param model - 实例固定版本的标准模型。
 * @param waiting - 当前活动实例或待匹配的事件定义位置。
 * @param definitions - 批量入口选择已经读取的事件定义，省略时读取当前节点。
 * @returns 声明的消息标识，匿名消息为空，非消息等待为未定义。
 */
export function declaredBpmnMessage(
  model: WorkflowBpmnModel,
  waiting: Pick<WorkflowBpmnActiveActivity, 'nodeId' | 'eventDefinitionIndex'>,
  definitions?: readonly WorkflowBpmnElement[],
): string | null | undefined {
  const element = model.elements[waiting.nodeId];
  if (element?.$type === BPMN_TYPE.ReceiveTask)
    return element.messageRef?.id ?? null;
  if (!BPMN_KIND_GROUPS.catchEvents.has(element?.$type)) return undefined;
  definitions ??= [
    ...(element.eventDefinitions ?? []),
    ...(element.eventDefinitionRef ?? []),
  ];
  if (definitions.length > 1 && waiting.eventDefinitionIndex === undefined)
    return undefined;
  const message = definitions[waiting.eventDefinitionIndex ?? 0];
  if (message?.$type !== BPMN_TYPE.MessageEventDefinition) return undefined;
  return message.messageRef?.id ?? null;
}

/**
 * 将同一流程作用域已确认及排队中的关联键合并后核验新消息，不提前提交未消费消息的键。
 * @param model - 固定发布版本。
 * @param state - 当前持久运行快照。
 * @param waiting - 精确等待的流程作用域。
 * @param message - 规范化的消息类型与正文。
 * @param input - 流程持久输入。
 * @param requireMatch - 自动查找已有实例时要求至少匹配一个既有键。
 * @returns 消费成功后才可提交的关联快照。
 * @throws 消息关联不匹配或缺少流程执行身份时拒绝接收。
 */
export function messageCorrelation(
  model: WorkflowBpmnModel,
  state: WorkflowBpmnRunState,
  waiting: WorkflowBpmnActiveActivity,
  message: { messageId: string | null; values: Record<string, unknown> },
  input: Record<string, unknown>,
  requireMatch = false,
): WorkflowMessageRecord['correlation'] {
  const processExecutionId = waiting.processExecutionId;
  let previous = state.correlations?.[processExecutionId] ?? {};
  for (const pending of state.messages ?? []) {
    if (
      pending.status === RUN_STATUS.pending &&
      pending.correlation?.processExecutionId === processExecutionId
    )
      previous = { ...previous, ...pending.correlation.keys };
  }
  const keys = correlateBpmnMessage(
    model,
    waiting.nodeId,
    message.messageId,
    message.values,
    { input, outputs: state.outputs },
    previous,
    requireMatch,
  );
  if (!Object.keys(keys).length) return undefined;
  requireDefinition(processExecutionId, '消息等待缺少流程作用域身份');
  return { processExecutionId, keys };
}

/**
 * 只准备匹配消息的顶层启动组，将首条回执与等待快照一起交给创建事务保存。
 * @param model - 业务当前统一绑定的固定模型。
 * @param input - 业务接口已经核验的持久输入。
 * @param message - 已密封的业务消息。
 * @returns 尚未执行后继业务步骤的完整等待状态。
 * @throws 无唯一启动入口、关联不符或预运行意外产生业务步骤时拒绝创建实例。
 */
export async function prepareBpmnMessageStart(
  model: WorkflowBpmnModel,
  input: Record<string, unknown>,
  message: WorkflowMessageIngress,
): Promise<WorkflowBpmnRunState> {
  const candidates: Array<{
    nodeId: string;
    eventDefinitionIndex?: number;
    processId: string;
    entryId: string;
  }> = [];
  const index = new WorkflowBpmnModelIndex(model);
  for (const element of index.elements) {
    const process = element.$parent;
    if (process?.$type !== BPMN_TYPE.Process || !process.isExecutable) continue;
    const incoming = index.incoming.get(element) ?? [];
    let entryId: string | undefined;
    if (
      element.$type === BPMN_TYPE.StartEvent ||
      (element.$type === BPMN_TYPE.ReceiveTask &&
        element.instantiate &&
        !incoming.length)
    )
      entryId = element.id;
    if (
      incoming.length === 1 &&
      incoming[0].sourceRef.$type === BPMN_TYPE.EventBasedGateway &&
      incoming[0].sourceRef.instantiate
    )
      entryId = incoming[0].sourceRef.id;
    if (!entryId) continue;
    const definitions = [
      ...(element.eventDefinitions ?? []),
      ...(element.eventDefinitionRef ?? []),
    ];
    const count = Math.max(1, definitions.length);
    for (let eventIndex = 0; eventIndex < count; eventIndex += 1) {
      const candidate = {
        nodeId: element.id,
        eventDefinitionIndex: eventIndex,
        processId: process.id,
        entryId,
      };
      if (
        declaredBpmnMessage(model, candidate, definitions) !== message.messageId
      )
        continue;
      try {
        correlateBpmnMessage(
          model,
          element.id,
          message.messageId,
          message.values,
          { input, outputs: {} },
          {},
        );
      } catch {
        continue;
      }
      candidates.push(candidate);
    }
  }
  requireDefinition(
    candidates.length === 1,
    '业务消息没有唯一且关联匹配的流程启动入口',
  );
  const selected = candidates[0];
  const advanced = await advanceWorkflowBpmn(
    model,
    null,
    { input },
    [],
    [],
    selected,
  );
  requireDefinition(
    advanced.status === RUN_STATUS.waiting && !advanced.jobs.length,
    '消息启动准备不能执行业务步骤',
  );
  const targets = advanced.activeActivities.filter(
    (item) =>
      item.nodeId === selected.nodeId &&
      declaredBpmnMessage(model, item) === message.messageId,
  );
  requireDefinition(targets.length === 1, '消息启动没有形成唯一等待实例');
  const waiting = targets[0];
  const state: WorkflowBpmnRunState = {
    checkpoint: advanced.checkpoint,
    status: advanced.status,
    error: advanced.error,
    nextWakeAt: advanced.nextWakeAt,
    outputs: advanced.checkpoint.outputs,
    activeActivities: advanced.activeActivities,
    transitions: advanced.transitions,
  };
  state.messages = [
    {
      deliveryId: message.deliveryId,
      nodeId: waiting.nodeId,
      executionId: waiting.executionId,
      status: RUN_STATUS.pending,
      receivedAt: new Date().toISOString(),
      deliveredAt: null,
      hash: message.ingressHash,
      ingressKey: message.ingressKey,
      ingressHash: message.ingressHash,
      values: message.values,
      correlation: messageCorrelation(model, state, waiting, message, input),
    },
  ];
  return state;
}
