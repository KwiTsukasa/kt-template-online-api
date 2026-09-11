import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { BotAdapterRegistry } from '@/modules/bot';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { Job, Queue, Worker } from 'bullmq';
import { parseExpression } from 'cron-parser';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import { BotAccountService } from '../account/bot-account.service';
import { BotPermissionService } from '../permission/bot-permission.service';
import { BotSendService } from '../send/bot-send.service';
import { BotChatHistoryService } from './bot-chat-history.service';

type ReminderData = {
  owner: string;
  sourcePluginKey: string;
  message: BotNormalizedMessage;
  text: string;
  platformId?: string;
  dueAt: string;
  repeat?: string;
};

@Injectable()
export class BotReminderService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BotReminderService.name);
  private readonly queue?: Queue<ReminderData>;
  private worker?: Worker<ReminderData>;
  constructor(
    private readonly config: ConfigService,
    private readonly permissions: BotPermissionService,
    private readonly accounts: BotAccountService,
    private readonly send: BotSendService,
    private readonly adapters: BotAdapterRegistry,
    private readonly history: BotChatHistoryService,
  ) {
    if (!this.connectionValue('HOST')) {
      this.logger.error('提醒队列缺少 Redis 连接，提醒功能暂不可用');
      return;
    }
    this.queue = new Queue<ReminderData>('bot-reminders', this.queueOptions());
    this.queue.on('error', (error) => this.logger.error(error.message));
  }

  async onApplicationBootstrap() {
    if (!this.queue) return;
    this.worker = new Worker<ReminderData>(
      'bot-reminders',
      async (job) => this.deliver(job),
      {
        ...this.queueOptions(),
        concurrency: 1,
      },
    );
    this.worker.on('error', (error) => this.logger.error(error.message));
    void this.worker
      .waitUntilReady()
      .catch((error) => this.logger.error(error.message));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * 提醒队列沿用 NAS Redis 凭据，通过独立前缀与插件调度任务分开持久保存。
   * @returns BullMQ 持久连接配置。
   */
  private queueOptions() {
    return {
      connection: {
        host: this.connectionValue('HOST'),
        port: Number(this.connectionValue('PORT') || 6379),
        db: Number(this.connectionValue('DB') || 0),
        password: this.connectionValue('PASSWORD') || undefined,
        connectTimeout: 5000,
      },
      prefix:
        this.config.get<string>('BOT_REMINDER_QUEUE_PREFIX') ||
        'kt:bot:reminders',
    };
  }

  /**
   * 提醒可单独指定 Redis，缺省时沿用现有队列基础设施连接而不依赖插件调度代码。
   * @param field - Redis 主机、端口、数据库或认证字段。
   * @returns 第一项非空连接设置，全部缺失时返回空字符串。
   */
  private connectionValue(field: 'HOST' | 'PORT' | 'DB' | 'PASSWORD'): string {
    for (const prefix of [
      'BOT_REMINDER_REDIS_',
      'PLUGIN_QUEUE_REDIS_',
      'REDIS_',
    ]) {
      const value = this.config.get<string | number>(prefix + field);
      if (value !== undefined && value !== null && String(value).trim())
        return String(value).trim();
    }
    return '';
  }

  /**
   * 将提醒归属绑定到发起人和当前会话，不能取消或列出其他发起人的任务。
   * @param message - 工具执行层绑定的原始消息。
   * @returns 同一发起人与同一会话稳定一致的归属前缀。
   */
  private owner(message: BotNormalizedMessage): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          message.selfId,
          message.messageType,
          message.targetId,
          message.userId,
        ]),
      )
      .digest('hex');
  }

  /**
   * 在持久队列创建、列出或取消当前用户提醒，只有入队成功后才返回已安排状态。
   * @param message - 已授权的真实发起人及发送目标。
   * @param input - 提醒动作、正文、时间与可选的当前群成员平台标识。
   * @param sourcePluginKey - 宿主绑定的调用插件，不能由模型指定。
   * @returns 已创建任务、取消结果或当前用户的任务状态。
   * @throws 参数不合法、超过限额或任务不属于当前用户时拒绝操作。
   */
  async manage(
    message: BotNormalizedMessage,
    input: Record<string, unknown>,
    sourcePluginKey: string,
  ) {
    if (!this.queue) throw new Error('提醒队列连接尚未配置');
    const owner = this.owner(message);
    const schedulers = (await this.queue.getJobSchedulers(0, -1)).filter(
      (item) => item.key.startsWith(owner + '-'),
    );
    const jobs = (
      await this.queue.getJobs(
        ['delayed', 'waiting', 'active', 'failed', 'completed'],
        0,
        999,
      )
    ).filter((job) => job.data.owner === owner);
    if (input.operation === 'list') {
      return {
        daily: schedulers.map((item) => ({
          id: item.key,
          nextRunAt: new Date(item.next).toISOString(),
          pattern: item.pattern,
          timezone: item.tz,
          text: item.template?.data?.text,
          platformId: item.template?.data?.platformId,
        })),
        jobs: await Promise.all(
          jobs.map(async (job) => ({
            id: job.id,
            text: job.data.text,
            platformId: job.data.platformId,
            dueAt: job.data.dueAt,
            status: await job.getState(),
            error: job.failedReason || '',
          })),
        ),
      };
    }
    if (input.operation === 'delete') {
      const id = String(input.id || '');
      if (!id.startsWith(owner + '-'))
        throw new Error('提醒不属于当前发起人与会话');
      if (schedulers.some((item) => item.key === id))
        return { cancelled: await this.queue.removeJobScheduler(id) };
      const job = jobs.find((item) => item.id === id);
      if (!job) throw new Error('提醒不存在');
      await job.remove();
      return { cancelled: true };
    }
    if (input.operation !== 'create') throw new Error('提醒动作无效');
    const text = String(input.text || '').trim();
    const dailyAt = String(input.dailyAt || '');
    const runAt = String(input.runAt || '');
    if (!text || text.length > 1200 || /\[CQ:|<(?:@|qqbot-)/iu.test(text))
      throw new Error('提醒正文应为1至1200字普通文本；真实提及请传platformId');
    let platformId: string | undefined;
    if (input.platformId !== undefined && input.platformId !== '') {
      if (message.messageType === 'private')
        throw new Error('私聊提醒不支持成员提及');
      if (typeof input.platformId !== 'string')
        throw new Error('成员平台ID无效');
      platformId = await this.history.requireMember(message, input.platformId);
    }
    if (Boolean(dailyAt) === Boolean(runAt))
      throw new Error('一次性时间与每日时刻必须且只能提供一个');
    if (
      schedulers.length +
        jobs.filter((job) => !job.data.repeat && !job.finishedOn).length >=
      20
    )
      throw new Error('当前会话最多保存20个待执行提醒');
    let dueAt: Date;
    let repeat = '';
    if (dailyAt) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(dailyAt))
        throw new Error('每日时间必须为24小时制HH:MM');
      const [hour, minute] = dailyAt.split(':').map(Number);
      repeat = `${minute} ${hour} * * *`;
      dueAt = parseExpression(repeat, { tz: 'Asia/Shanghai' }).next().toDate();
    } else {
      if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(runAt))
        throw new Error('一次性时间必须明确时区');
      dueAt = new Date(runAt);
      if (
        !Number.isFinite(dueAt.getTime()) ||
        dueAt.getTime() < Date.now() + 10000 ||
        dueAt.getTime() > Date.now() + 366 * 86400000
      )
        throw new Error('提醒时间应在10秒后至一年以内');
    }
    const id = owner + '-' + randomUUID();
    // 只保存未来投递所需目标，绝不复用已过期的被动回复凭据或原文附件。
    const data: ReminderData = {
      owner,
      sourcePluginKey,
      text,
      platformId,
      dueAt: dueAt.toISOString(),
      repeat,
      message: {
        selfId: message.selfId,
        connectionMode: message.connectionMode,
        messageType: message.messageType,
        targetId: message.targetId,
        userId: message.userId,
        channelId: message.channelId,
        guildId: message.guildId,
        messageId: id,
        messageText: text,
        rawMessage: text,
        rawEvent: {},
        eventTime: new Date(),
      },
    };
    const opts = {
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    };
    if (repeat)
      await this.queue.upsertJobScheduler(
        id,
        { pattern: repeat, tz: 'Asia/Shanghai' },
        { name: 'remind', data, opts },
      );
    else
      await this.queue.add('remind', data, {
        ...opts,
        jobId: id,
        delay: dueAt.getTime() - Date.now(),
      });
    return {
      id,
      status: 'scheduled',
      platformId,
      nextRunAt: dueAt.toISOString(),
      timezone: 'Asia/Shanghai',
      delivery:
        '执行时检查权限并记录发送结果；平台拒绝会记为失败，不冒充已送达',
    };
  }

  /**
   * 到期重新检查发起人和 Bot 绑定，再通过统一发送服务投递，平台拒绝时保留失败任务。
   * @param job - Redis 持久队列中的提醒任务。
   * @returns 统一发送服务返回的投递结果。
   * @throws 发起人权限或插件绑定已撤销、持久化成员标识无效时拒绝发送。
   */
  async deliver(job: Job<ReminderData>): Promise<unknown> {
    const message = job.data.message;
    if (
      (await this.permissions.isBlocked(message)) ||
      !(await this.permissions.isAllowed(message))
    )
      throw new Error('提醒发起人权限已撤销');
    let pluginKeys: string[];
    if (
      message.connectionMode === 'official-websocket' ||
      message.connectionMode === 'official-webhook'
    ) {
      const adapter = this.adapters.require('tencent');
      if (!adapter.listBoundPluginKeys)
        throw new Error('官方适配器无法核验当前授权');
      pluginKeys = await adapter.listBoundPluginKeys(message.selfId);
    } else {
      pluginKeys = await this.accounts.getBoundEventPluginKeys(message.selfId);
    }
    if (
      !job.data.sourcePluginKey ||
      !pluginKeys.includes(job.data.sourcePluginKey)
    )
      throw new Error('提醒来源插件绑定已撤销');
    let text = job.data.text;
    const platformId = job.data.platformId;
    if (platformId !== undefined) {
      if (
        message.messageType === 'private' ||
        !/^[a-zA-Z0-9_-]{1,64}$/u.test(platformId)
      )
        throw new Error('提醒成员平台ID无效');
      // 成员已在创建时按当前 Bot 和群核验；这里只读取持久目标，不依赖过期工具上下文。
      let tag = `<qqbot-at-user id="${platformId}" />`;
      if (message.connectionMode === 'reverse-ws')
        tag = `[CQ:at,qq=${platformId}]`;
      else if (message.messageType === 'channel') tag = `<@${platformId}>`;
      text = `${tag} ${text}`;
    }
    return this.send.sendText({
      selfId: message.selfId,
      targetType: message.messageType,
      targetId: message.targetId,
      channelId: message.channelId,
      guildId: message.guildId,
      message: text,
    });
  }
}
