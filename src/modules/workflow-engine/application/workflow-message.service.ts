import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { definitionRecord } from '@/common/automation/definition.types';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import type { WorkflowMessageDelivery, WorkflowMessageIngress, WorkflowMessageReceipt } from '../contract/workflow-message.types';
import { parseWorkflowBpmn } from '../domain/workflow-bpmn.policy';
import { WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { declaredBpmnMessage, messageCorrelation, normalizeMessageValue } from '../domain/workflow-message.policy';

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
    const { deliveryId, nodeId, executionId, messageId, senderId, values } = delivery;
    return this.accept(runId, { deliveryId, nodeId, executionId, messageId, senderId, values });
  }

  /**
   * 在工作流锁内按标准关联键查找唯一等待节点，业务模块无需提供节点或执行标识。
   * @param runId - 业务锁已经核验归属的活动实例。
   * @param message - 业务入口生成的规范化消息及幂等摘要。
   * @returns 已持久保存的消息回执。
   */
  async receiveBusiness(runId: string, message: WorkflowMessageIngress): Promise<WorkflowMessageReceipt> {
    return this.accept(runId, message);
  }

  /**
   * 在同一个锁和事务中检查幂等回执、匹配等待并保存消息，避免查找与推进之间的竞争。
   * @param runId - 已核验归属的实例。
   * @param incoming - 精确节点投递或由业务服务密封的自动投递。
   * @returns 不含消息正文的持久回执。
   * @throws 重复内容冲突、关联不唯一或实例不再接收消息时拒绝写入。
   */
  private async accept(runId: string, incoming: WorkflowMessageDelivery | WorkflowMessageIngress): Promise<WorkflowMessageReceipt> {
    let ingress: WorkflowMessageIngress | undefined;
    let delivery: WorkflowMessageDelivery;
    if ('ingressKey' in incoming) {
      ingress = incoming;
      delivery = { ...incoming, nodeId: '', executionId: '' };
    } else delivery = incoming;
    const envelope = validateDefinitionInput(() => definitionRecord(delivery));
    const identityKeys = ['deliveryId', 'senderId'];
    if (!ingress) identityKeys.push('nodeId', 'executionId');
    for (const key of identityKeys) {
      if (typeof envelope[key] !== 'string' || !envelope[key].trim() || envelope[key].length > 191) throw new BadRequestException('消息投递身份不能为空或超过 191 个字符');
    }
    if (delivery.messageId !== null && (typeof delivery.messageId !== 'string' || !delivery.messageId || delivery.messageId.length > 191)) throw new BadRequestException('消息类型标识无效');
    const values = validateDefinitionInput(() => normalizeMessageValue(definitionRecord(delivery.values))) as Record<string, unknown>;
    const serialized = JSON.stringify({ nodeId: delivery.nodeId, executionId: delivery.executionId, messageId: delivery.messageId, senderId: delivery.senderId, values });
    if (Buffer.byteLength(serialized) > 64 * 1024) throw new BadRequestException('单条工作流消息不能超过 64 KiB');
    let hash = createHash('sha256').update(serialized).digest('hex');
    if (ingress) hash = ingress.ingressHash;
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
        const previous = messages.find((item) => {
          if (ingress) return item.ingressKey === ingress.ingressKey;
          return item.deliveryId === delivery.deliveryId && !item.ingressKey;
        });
        if (previous) {
          if (previous.hash !== hash) throw new ConflictException('同一投递标识已经接收了不同消息');
          return {
            deliveryId: previous.deliveryId, nodeId: previous.nodeId, executionId: previous.executionId,
            status: previous.status, receivedAt: previous.receivedAt, deliveredAt: previous.deliveredAt,
          };
        }
        if (!run.bpmnState || run.cancelRequested || run.errorMessage || !['pending', 'running', 'waiting'].includes(run.status) || new Date(run.deadlineAt).getTime() <= Date.now()) throw new ConflictException('工作流实例已经停止接收消息');
        const model = await parseWorkflowBpmn(await this.definitions.resolve({ id: run.workflowId, version: run.workflowVersion }));
        if (ingress) {
          const matches = (run.bpmnState.activeActivities ?? []).filter((item) => {
            if (declaredBpmnMessage(model, item) !== delivery.messageId) return false;
            try { messageCorrelation(model, run.bpmnState, item, { messageId: delivery.messageId, values }, run.inputValues, true); return true; }
            catch { return false; }
          });
          if (matches.length !== 1) throw new ConflictException('业务消息没有唯一且关联匹配的活动等待');
          delivery = { ...delivery, nodeId: matches[0].nodeId, executionId: matches[0].executionId };
        }
        const waiting = run.bpmnState.activeActivities?.find((item) => item.nodeId === delivery.nodeId && item.executionId === delivery.executionId);
        if (!waiting) throw new ConflictException('消息等待实例已经失效');
        if (messages.length >= 4096 || messages.filter((item) => item.status === 'pending').length >= 128) throw new ConflictException('当前流程的消息回执或等待队列达到上限');
        if (messages.some((item) => item.executionId === delivery.executionId && item.status === 'pending')) throw new ConflictException('该活动实例已经接收消息');
        const declaredMessageId = declaredBpmnMessage(model, waiting);
        if (declaredMessageId === undefined) throw new BadRequestException('目标活动不是消息捕获事件或接收任务');
        if (delivery.messageId !== declaredMessageId) throw new BadRequestException('消息类型与当前等待声明不一致');
        const correlation = validateDefinitionInput(() => messageCorrelation(model, run.bpmnState, waiting, { messageId: delivery.messageId, values }, run.inputValues, Boolean(ingress)));
        const receipt: WorkflowMessageReceipt = { deliveryId: delivery.deliveryId, nodeId: delivery.nodeId, executionId: delivery.executionId, status: 'pending', receivedAt: new Date().toISOString(), deliveredAt: null };
        run.bpmnState.messages = [...messages, { ...receipt, hash, values, correlation, ingressKey: ingress?.ingressKey, ingressHash: ingress?.ingressHash }];
        await manager.update(WorkflowRun, { id: run.id }, { bpmnState: run.bpmnState, nextWakeAt: new Date() });
        return receipt;
      });
    } finally {
      try { if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]); }
      finally { await connection.release(); }
    }
  }
}
