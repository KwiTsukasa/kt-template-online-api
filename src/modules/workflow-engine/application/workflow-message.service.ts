import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { definitionRecord } from '@/common/automation/definition.types';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import type { WorkflowMessageDelivery, WorkflowMessageReceipt } from '../contract/workflow-message.types';
import { parseWorkflowBpmn } from '../domain/workflow-bpmn.policy';
import { WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowDefinitionService } from './workflow-definition.service';

@Injectable()
export class WorkflowMessageService {
  constructor(private readonly database: DataSource, private readonly definitions: WorkflowDefinitionService) {}

  /**
   * 在流程锁内保存已鉴权业务消息，重复投递返回原回执，实际推进仍由工作流队列完成。
   * @param runId - 业务权限边界确认所属对象后的流程实例。
   * @param delivery - 稳定投递键、发送方、声明的消息和准确等待实例。
   * @returns 不含消息正文的持久投递回执。
   * @throws 消息格式不合法、实例过期、目标不是消息等待或同一投递键内容冲突时拒绝接收。
   */
  async receive(runId: string, delivery: WorkflowMessageDelivery): Promise<WorkflowMessageReceipt> {
    const envelope = validateDefinitionInput(() => definitionRecord(delivery));
    for (const key of ['deliveryId', 'nodeId', 'executionId', 'senderId']) {
      if (typeof envelope[key] !== 'string' || !envelope[key].trim() || envelope[key].length > 191) throw new BadRequestException('消息投递身份不能为空或超过 191 个字符');
    }
    if (delivery.messageId !== null && (typeof delivery.messageId !== 'string' || !delivery.messageId || delivery.messageId.length > 191)) throw new BadRequestException('消息类型标识无效');
    const values = validateDefinitionInput(() => normalizeMessageValue(definitionRecord(delivery.values))) as Record<string, unknown>;
    const serialized = JSON.stringify({ nodeId: delivery.nodeId, executionId: delivery.executionId, messageId: delivery.messageId, senderId: delivery.senderId, values });
    if (Buffer.byteLength(serialized) > 64 * 1024) throw new BadRequestException('单条工作流消息不能超过 64 KiB');
    const hash = createHash('sha256').update(serialized).digest('hex');
    const connection = this.database.createQueryRunner();
    const lock = `kt:workflow:${runId}`;
    let acquired = false;
    try {
      await connection.connect();
      acquired = Number((await connection.query('SELECT GET_LOCK(?, 3) acquired', [lock]))[0]?.acquired) === 1;
      if (!acquired) throw new ConflictException('流程正在推进，请稍后投递');
      return await connection.manager.transaction(async (manager) => {
        const run = await manager.findOne(WorkflowRun, { where: { id: runId }, lock: { mode: 'pessimistic_write' } });
        if (!run) throw new NotFoundException('工作流实例不存在');
        const messages = run.bpmnState?.messages ?? [];
        const previous = messages.find((item) => item.deliveryId === delivery.deliveryId);
        if (previous) {
          if (previous.hash !== hash) throw new ConflictException('同一投递标识已经接收了不同消息');
          return {
            deliveryId: previous.deliveryId, nodeId: previous.nodeId, executionId: previous.executionId,
            status: previous.status, receivedAt: previous.receivedAt, deliveredAt: previous.deliveredAt,
          };
        }
        if (!run.bpmnState || run.cancelRequested || run.errorMessage || !['pending', 'running', 'waiting'].includes(run.status) || new Date(run.deadlineAt).getTime() <= Date.now()) throw new ConflictException('工作流实例已经停止接收消息');
        const waiting = run.bpmnState.activeActivities?.find((item) => item.nodeId === delivery.nodeId && item.executionId === delivery.executionId);
        if (!waiting) throw new ConflictException('消息等待实例已经失效');
        if (messages.length >= 4096 || messages.filter((item) => item.status === 'pending').length >= 128) throw new ConflictException('当前流程的消息回执或等待队列达到上限');
        if (messages.some((item) => item.executionId === delivery.executionId && item.status === 'pending')) throw new ConflictException('该活动实例已经接收消息');
        const model = await parseWorkflowBpmn(await this.definitions.resolve({ id: run.workflowId, version: run.workflowVersion }));
        const element = model.elements[delivery.nodeId];
        const definitions = [...(element?.eventDefinitions ?? []), ...(element?.eventDefinitionRef ?? [])];
        let message = definitions[waiting.eventDefinitionIndex ?? 0];
        if (definitions.length > 1 && waiting.eventDefinitionIndex === undefined) message = undefined;
        let declaredMessageId: string | null = null;
        if (element?.$type === 'bpmn:ReceiveTask') declaredMessageId = element.messageRef?.id ?? null;
        else if (['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'].includes(element?.$type) && message?.$type === 'bpmn:MessageEventDefinition') declaredMessageId = message.messageRef?.id ?? null;
        else throw new BadRequestException('目标活动不是消息捕获事件或接收任务');
        if (delivery.messageId !== declaredMessageId) throw new BadRequestException('消息类型与当前等待声明不一致');
        const receipt: WorkflowMessageReceipt = { deliveryId: delivery.deliveryId, nodeId: delivery.nodeId, executionId: delivery.executionId, status: 'pending', receivedAt: new Date().toISOString(), deliveredAt: null };
        run.bpmnState.messages = [...messages, { ...receipt, hash, values }];
        await manager.update(WorkflowRun, { id: run.id }, { bpmnState: run.bpmnState, nextWakeAt: new Date() });
        return receipt;
      });
    } finally {
      try { if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]); }
      finally { await connection.release(); }
    }
  }
}

/**
 * 固定消息字段排序并拒绝原型、非 JSON 数值及过深对象，使重试内容的幂等比较不受键顺序影响。
 * @param value - 待保存的消息字段或嵌套值。
 * @param depth - 当前嵌套深度，用于限制递归。
 * @returns 可稳定序列化的 JSON 值。
 * @throws 不支持的类型、危险属性或超过十六层嵌套时拒绝消息。
 */
function normalizeMessageValue(value: unknown, depth = 0): unknown {
  if (depth > 16) throw new Error('消息字段不能超过十六层嵌套');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeMessageValue(item, depth + 1));
  const record = definitionRecord(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('消息字段不允许原型属性');
    result[key] = normalizeMessageValue(record[key], depth + 1);
  }
  return result;
}
