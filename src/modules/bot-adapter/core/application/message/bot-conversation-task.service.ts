import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import { BotAdapterRegistry } from '@/modules/bot';
import type {
  BotPluginMessageEvent,
  BotPluginEventResult,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import {
  PLUGIN_EXECUTION_PORT,
  type PluginExecutionPort,
} from '../../domain/plugin-execution.port';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import { BotAccountService } from '../account/bot-account.service';
import { BotPermissionService } from '../permission/bot-permission.service';
import { BotToolSessionService } from '../command/bot-tool-session.service';
import { BotSendService } from '../send/bot-send.service';
import { BotSendAttemptError } from '../send/bot-send.error';
import { BotArtifactService } from './bot-artifact.service';
import {
  BotTaskStoreService,
  botTaskConnection,
} from './bot-task-store.service';

type TaskData = {
  message: BotNormalizedMessage;
  event: BotPluginMessageEvent;
  pluginKey: string;
  contextId: string;
  expiresAt: number;
  conversation: string;
  state:
    | 'queued'
    | 'running'
    | 'ready'
    | 'sending'
    | 'pending'
    | 'uncertain'
    | 'delivered'
    | 'failed';
  resultHash?: string;
  cursor: number;
  attempt: number;
  deliveryId?: string;
  error?: string;
  completedAt?: number;
  deliveryMessage?: BotNormalizedMessage;
  executionOutcome?: 'completed' | 'failed';
  executionError?: string;
  contextPrepared?: boolean;
};

@Injectable()
export class BotConversationTaskService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BotConversationTaskService.name);
  private readonly queue?: Queue<TaskData>;
  private worker?: Worker<TaskData>;
  private readonly stops = new Map<string, () => void>();
  constructor(
    private readonly config: ConfigService,
    private readonly store: BotTaskStoreService,
    private readonly tools: BotToolSessionService,
    private readonly permissions: BotPermissionService,
    private readonly accounts: BotAccountService,
    private readonly adapters: BotAdapterRegistry,
    private readonly artifacts: BotArtifactService,
    private readonly send: BotSendService,
    @Inject(PLUGIN_EXECUTION_PORT)
    private readonly plugins: PluginExecutionPort,
  ) {
    const connection = botTaskConnection(config);
    if (connection) {
      this.queue = new Queue<TaskData>('conversation', {
        connection,
        prefix: 'kt:bot:tasks',
      });
      this.queue.on('error', (error) => this.logger.error(error.message));
    }
  }
  async onApplicationBootstrap() {
    const connection = botTaskConnection(this.config);
    if (!connection || !this.queue) return;
    this.worker = new Worker<TaskData>(
      'conversation',
      (job, token) => this.process(job, token),
      {
        connection,
        prefix: 'kt:bot:tasks',
        concurrency: 3,
        lockDuration: 120000,
      },
    );
    this.worker.on('error', (error) => this.logger.error(error.message));
    this.worker.on('failed', (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
        void this.recordFailure(job, error).catch((failure) =>
          this.logger.error(failure.message),
        );
      }
    });
  }
  async onModuleDestroy() {
    for (const stop of this.stops.values()) stop();
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * 重试耗尽后记录执行失败并撤销授权，释放群队列，保留原任务和未知发送结果供核实。
   * @param job - 已耗尽重试次数的持久任务。
   * @param error - 当前基础设施或插件的最后一次失败。
   */
  async recordFailure(job: Job<TaskData>, error: Error): Promise<void> {
    const data = job.data;
    if (data.state === 'sending' || data.state === 'uncertain') {
      data.state = 'uncertain';
      data.error = 'delivery_not_confirmed';
    } else {
      data.state = 'failed';
      data.error = 'task_retries_exhausted';
    }
    if (!data.resultHash) {
      data.executionOutcome = 'failed';
      data.executionError = 'task_retries_exhausted';
    }
    this.logger.error(`后台任务 ${job.id} 重试耗尽：${error.message}`);
    await this.save(job, data);
    await this.finishInference(job);
  }

  /**
   * 将原始消息和权限身份写入持久队列，同群使用序列号保持发言顺序。
   * @param message - 已授权并保存的入站消息。
   * @param event - 含同群上下文的插件信封。
   * @param pluginKey - 当前启用的单一事件插件。
   * @param startThinking - 当前连接提供的可选 Loading 入口。
   * @returns 已存在或新创建的持久任务标识。
   * @throws 持久队列未配置时拒绝假装后台任务已启动。
   */
  async enqueue(
    message: BotNormalizedMessage,
    event: BotPluginMessageEvent,
    pluginKey: string,
    startThinking?: () => () => void,
  ): Promise<string> {
    if (!this.queue || !this.store.redis)
      throw new Error('Bot后台任务队列未配置');
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          message.selfId,
          event.conversationKey,
          event.eventId,
          pluginKey,
        ]),
      )
      .digest('hex');
    if (await this.queue.getJob(id)) return id;
    const contextId = randomUUID();
    const expiresAt = Date.now() + 3600000;
    const sequence = await this.store.redis.incr('kt:bot:tasks:sequence');
    const conversation = `kt:bot:tasks:order:${event.conversationKey}`;
    // 队列和排序索引分步写入；短期标记区分正在入队与崩溃遗留的空索引。
    const enqueuing = `kt:bot:tasks:enqueuing:${id}`;
    await this.store.redis.set(enqueuing, '1', 'EX', 30);
    await this.tools.openDurable(contextId, message, expiresAt, pluginKey);
    await this.store.redis.zadd(conversation, 'NX', sequence, id);
    try {
      await this.store.progress(event.conversationKey, id, {
        taskId: id,
        messageId: event.eventId,
        sender: message.senderNickname,
        question: message.messageText.slice(0, 500),
        state: 'queued',
      });
      await this.queue.add(
        'message',
        {
          message,
          event: {
            ...event,
            metadata: {
              ...event.metadata,
              durableTask: true,
              toolContextId: contextId,
              taskExpiresAt: expiresAt,
            },
          },
          pluginKey,
          contextId,
          expiresAt,
          conversation,
          state: 'queued',
          cursor: 0,
          attempt: 0,
        },
        {
          jobId: id,
          attempts: 360,
          backoff: { type: 'fixed', delay: 10000 },
          removeOnComplete: { age: 604800 },
          removeOnFail: { age: 604800 },
        },
      );
      if (startThinking) this.stops.set(id, startThinking());
    } catch (error) {
      await this.store.redis.zrem(conversation, id);
      await this.tools.closeDurable(contextId);
      throw error;
    } finally {
      await this.store.redis.del(enqueuing);
    }
    return id;
  }

  /**
   * 在同群获得新的被动回复机会时，将已完成且明确未送达的结果重新入队，避免重新推理。
   * @param message - 新到达且已通过权限检查的真实消息。
   * @param event - 用于确认提及及会话身份的信封。
   * @returns 已唤醒结果的数量，不重新运行模型。
   */
  async wakePending(
    message: BotNormalizedMessage,
    event: BotPluginMessageEvent,
  ): Promise<number> {
    if (
      !this.queue ||
      !this.store.redis ||
      (event.scope !== 'direct' && event.metadata.mentioned !== true)
    )
      return 0;
    const key = `kt:bot:tasks:pending:${event.conversationKey}`;
    const ids = await this.store.redis.smembers(key);
    let count = 0;
    for (const id of ids) {
      const job = await this.queue.getJob(id);
      if (!job || job.data.state === 'delivered') {
        await this.store.redis.srem(key, id);
        continue;
      }
      if (
        job.data.state !== 'pending' ||
        (await job.getState()) !== 'completed'
      )
        continue;
      await this.save(job, {
        ...job.data,
        state: 'ready',
        deliveryMessage: message,
      });
      await job.retry('completed');
      count++;
      break;
    }
    return count;
  }

  /**
   * 每个任务步骤都重新核对发送者权限和当前插件绑定，权限撤销立即阻断后台操作。
   * @param data - 队列保存的真实消息与插件归属。
   * @returns 当前账号和发起人是否仍有执行权。
   */
  private async allowed(data: TaskData): Promise<boolean> {
    if (
      (await this.permissions.isBlocked(data.message)) ||
      !(await this.permissions.isAllowed(data.message))
    )
      return false;
    let keys: string[];
    if (data.message.connectionMode === 'reverse-ws')
      keys = await this.accounts.getBoundEventPluginKeys(data.message.selfId);
    else
      keys =
        (await this.adapters
          .require('tencent')
          .listBoundPluginKeys?.(data.message.selfId)) || [];
    return keys.includes(data.pluginKey);
  }

  /**
   * 按同群序号调用单个插件，保存续执行状态或完整结果，再独立推进平台投递。
   * @param job - BullMQ 已锁定的持久任务。
   * @param token - 当前工作线程持有的延迟调度令牌。
   * @throws 队列延迟信号或暂时性基础设施错误交由 BullMQ 恢复。
   */
  async process(job: Job<TaskData>, token?: string): Promise<void> {
    let data = job.data;
    data.message.eventTime = new Date(data.message.eventTime);
    if (data.state === 'failed') {
      await this.finishInference(job);
      return;
    }
    if (!(await this.allowed(data))) {
      data.state = 'failed';
      data.error = 'authorization_revoked';
      data.executionOutcome = 'failed';
      data.executionError = 'authorization_revoked';
      await this.save(job, data);
      await this.finishInference(job);
      return;
    }
    if (data.resultHash) await this.finishInference(job);
    if (!data.resultHash) {
      const first = await this.store.redis!.zrange(data.conversation, 0, 0);
      if (first.length && first[0] !== job.id) {
        const head = await this.queue?.getJob(first[0]);
        if (
          !head &&
          !(await this.store.redis!.exists(
            `kt:bot:tasks:enqueuing:${first[0]}`,
          ))
        ) {
          await this.store.redis!.zrem(data.conversation, first[0]);
        }
        await job.moveToDelayed(Date.now() + 2000, token);
        throw new DelayedError();
      }
      if (Date.now() >= data.expiresAt) data.event.metadata.taskExpired = true;
      if (
        data.event.metadata.taskExpired &&
        !data.event.metadata.continuation
      ) {
        data.state = 'failed';
        data.error = 'authorization_expired_before_start';
        data.executionOutcome = 'failed';
        data.executionError = data.error;
        await this.save(job, data);
        await this.finishInference(job);
        return;
      }
      data.state = 'running';
      await this.save(job, data);
      await this.prepareContext(job);
      data = job.data;
      const event = { ...data.event, metadata: { ...data.event.metadata } };
      if (!event.metadata.continuation && event.imageUrls?.length) {
        event.metadata.imageDataUrls = [];
        for (const [index] of event.imageUrls.entries()) {
          const image = await this.artifacts.readImage(data.message, {
            messageId: data.message.messageId,
            index,
          });
          (event.metadata.imageDataUrls as string[]).push(
            `data:${image.mimeType};base64,${image.data}`,
          );
        }
      }
      const result = await this.plugins.dispatchEvent({
        event,
        eventKey: 'message',
        pluginKeys: [data.pluginKey],
      });
      if (result.handled && !data.event.metadata.continuation)
        await this.rememberContext(data);
      if (result.continuation) {
        data.event.metadata.continuation = result.continuation.state;
        await this.save(job, data);
        await job.moveToDelayed(
          Date.now() + result.continuation.delayMs,
          token,
        );
        throw new DelayedError();
      }
      if (!result.handled) throw new Error('事件插件尚未就绪或未处理任务');
      data.resultHash = await this.artifacts.saveResult(job.id!, result);
      data.executionOutcome = 'completed';
      if (result.failureCode) {
        data.executionOutcome = 'failed';
        data.executionError = result.failureCode;
      }
      data.completedAt = Date.now();
      data.state = 'ready';
      await this.save(job, data);
      await this.finishInference(job);
    }
    await this.deliver(job);
  }

  /**
   * 在首次提交前剔除同群已传入的历史记录，并固定本任务输入以支持幂等重试。
   * @param job - 已取得同群顺序执行权的任务。
   */
  private async prepareContext(job: Job<TaskData>): Promise<void> {
    const data = job.data;
    if (data.contextPrepared || data.event.metadata.continuation) return;
    const known = new Set<string>(
      (await this.store.read(
        `observed:${data.pluginKey}:${data.event.conversationKey}`,
      )) || [],
    );
    const recent = data.event.metadata.recentMessages;
    if (Array.isArray(recent))
      data.event.metadata.recentMessages = recent.filter(
        (row) => !known.has(String(row.messageId || row.id || '')),
      );
    data.contextPrepared = true;
    await this.save(job, data);
  }

  /**
   * 仅在插件确认接收输入后保存同群已传入的消息标识，重启后继续补齐新发言而不重复整段历史。
   * @param data - 已确认启动或完成的单次任务。
   */
  private async rememberContext(data: TaskData): Promise<void> {
    const key = `observed:${data.pluginKey}:${data.event.conversationKey}`;
    const known = new Set<string>((await this.store.read(key)) || []);
    const recent = data.event.metadata.recentMessages;
    if (Array.isArray(recent)) {
      for (const row of recent) {
        const id = String(row.messageId || row.id || '');
        if (id) known.add(id);
      }
    }
    known.add(data.event.eventId);
    await this.store.write(key, [...known].slice(-600), 604800);
  }

  /**
   * 推理结束后撤销工具授权并释放同群排队位置，避免投递等待阻塞下一位成员。
   * @param job - 已保存最终结果或明确取消的任务。
   */
  private async finishInference(job: Job<TaskData>): Promise<void> {
    await this.tools.closeDurable(job.data.contextId);
    await this.store.redis!.zrem(job.data.conversation, job.id!);
    this.stops.get(job.id!)?.();
    this.stops.delete(job.id!);
  }

  /**
   * 同步任务执行数据和用户可查询的进度，保存结果时明确列出待发送段数。
   * @param job - 当前持久任务。
   * @param data - 已完成本步骤变更的任务数据。
   */
  private async save(job: Job<TaskData>, data: TaskData): Promise<void> {
    await job.updateData(data);
    await this.store.progress(data.event.conversationKey, job.id!, {
      taskId: job.id,
      messageId: data.message.messageId,
      sender: data.message.senderNickname,
      question: data.message.messageText.slice(0, 500),
      state: data.state,
      completedAt: data.completedAt,
      sentParts: data.cursor,
      error: data.error || '',
      executionOutcome: data.executionOutcome,
      executionError: data.executionError,
      run: data.event.metadata.continuation || null,
    });
  }

  /**
   * 按已确认发送游标投递结果，拒绝把网络超时认作未发送并盲目重试。
   * @param job - 持有完整结果引用和发送进度的任务。
   */
  private async deliver(job: Job<TaskData>): Promise<void> {
    const data = job.data;
    const result = (await this.artifacts.readResult(
      job.id!,
      data.resultHash!,
    )) as BotPluginEventResult;
    if (data.state === 'sending' && data.deliveryId) {
      const log = await this.send.readDelivery(
        data.message.selfId,
        data.deliveryId,
      );
      if (log?.status === 'success') {
        data.cursor++;
        data.state = 'ready';
      } else {
        data.state = 'uncertain';
        data.error = 'delivery_not_confirmed';
      }
      await this.save(job, data);
    }
    if (data.state === 'uncertain' || data.state === 'delivered') return;
    const target = data.deliveryMessage || data.message;
    for (; data.cursor < result.replies.length; data.cursor++) {
      const reply = result.replies[data.cursor];
      let content = reply.content;
      if (reply.kind === 'image')
        content = `[CQ:image,file=base64://${content}]`;
      let replyMessageId = target.replyMessageId;
      let adapterReplyContext = target.adapterReplyContext;
      let windowMs = 300000;
      if (target.messageType === 'private' && !target.guildId)
        windowMs = 3600000;
      if (
        target.connectionMode !== 'reverse-ws' &&
        Date.now() >= new Date(target.eventTime).getTime() + windowMs - 10000
      ) {
        replyMessageId = undefined;
        adapterReplyContext = undefined;
      }
      data.attempt++;
      data.deliveryId = `${job.id}-${data.cursor}-${data.attempt}`;
      data.state = 'sending';
      await this.save(job, data);
      try {
        await this.send.sendText({
          selfId: target.selfId,
          targetId: target.targetId,
          targetType: target.messageType,
          channelId: target.channelId,
          guildId: target.guildId,
          message: content,
          replyMessageId,
          adapterReplyContext,
          deliveryId: data.deliveryId,
        });
      } catch (error) {
        data.state = 'uncertain';
        data.error = 'delivery_not_confirmed';
        if (
          error instanceof BotSendAttemptError &&
          [
            'official_rejected',
            'onebot_rejected',
            'official_disconnected',
            'onebot_disconnected',
            'account_unavailable',
          ].includes(error.code)
        ) {
          data.state = 'pending';
          data.error = error.code;
          await this.store.redis!.sadd(
            `kt:bot:tasks:pending:${data.event.conversationKey}`,
            job.id!,
          );
        }
        await this.save(job, data);
        return;
      }
      // 游标先落盘再发送下一段；崩溃时依靠发送凭证核实这一段。
      await this.save(job, {
        ...data,
        cursor: data.cursor + 1,
        state: 'ready',
      });
    }
    data.state = 'delivered';
    await this.save(job, data);
    await this.store.redis!.srem(
      `kt:bot:tasks:pending:${data.event.conversationKey}`,
      job.id!,
    );
  }
}
