import { Injectable } from '@nestjs/common';
import { BotAdapterRegistry } from '@/modules/bot';
import { createHash, randomUUID } from 'node:crypto';
import { parseExpression } from 'cron-parser';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import { BotAccountService } from '../account/bot-account.service';
import { BotPermissionService } from '../permission/bot-permission.service';
import { BotSendService } from '../send/bot-send.service';
import { BotChatHistoryService } from './bot-chat-history.service';
import { ToolsService } from '@/common';
import { BotReminderStore } from './bot-reminder.store';
import type {
  BotReminderData,
  BotReminderPort,
  BotReminderScheduling,
} from '../../contract/message/bot-reminder.port';

@Injectable()
export class BotReminderService implements BotReminderPort {
  private scheduler?: BotReminderScheduling;
  constructor(
    private readonly store: BotReminderStore,
    private readonly permissions: BotPermissionService,
    private readonly accounts: BotAccountService,
    private readonly send: BotSendService,
    private readonly adapters: BotAdapterRegistry,
    private readonly history: BotChatHistoryService,
    private readonly tools: ToolsService = new ToolsService(),
  ) {}

  /**
   * 接入应用层提供的调度适配器，Bot 领域自身不引入触发器或调度模块。
   * @param scheduler - 提供确认、状态和取消能力的应用适配器。
   * @returns 只释放本次装配的函数。
   * @throws 已装配其他调度适配器时拒绝双重拥有者。
   */
  attach(scheduler: BotReminderScheduling): () => void {
    if (this.scheduler) throw new Error('提醒调度适配器已经装配');
    this.scheduler = scheduler;
    return () => {
      if (this.scheduler === scheduler) this.scheduler = undefined;
    };
  }

  /**
   * 将尚未确认的创建或取消意图交给应用装配层恢复，不在业务模块运行时钟。
   * @param afterId - 上一批的提醒身份游标。
   * @returns 最多一百条待恢复身份。
   */
  pending(afterId: string): Promise<string[]> {
    return this.store.pending(afterId);
  }

  /**
   * 以持久提醒身份幂等确认计划，取消先持久化意图，恢复时不会重新激活已取消提醒。
   * @param id - 需要与调度适配器同步的提醒。
   * @throws 未装配、调度失败或保存失败时保留待恢复意图并报告实际错误。
   */
  async synchronize(id: string): Promise<void> {
    const scheduler = this.scheduler;
    if (!scheduler) throw new Error('提醒调度尚未装配');
    await this.store.withReminder(id, async (row, manager) => {
      if (!row.syncPending) return;
      try {
        if (!row.scheduleId) {
          const state = await scheduler.ensure({
            id,
            dueAt: row.data.dueAt,
            repeat: row.data.repeat,
          });
          row.scheduleId = state.scheduleId;
          await manager.save(row);
        }
        if (row.status === 'cancelled') await scheduler.close(row.scheduleId);
        else if (row.status === 'pending') {
          const state = await scheduler.read(row.scheduleId);
          if (!state.enabled)
            throw new Error('提醒计划未启用，请在调度计划中处理');
          row.status = 'scheduled';
        }
        row.syncPending = false;
        row.lastError = null;
        await manager.save(row);
      } catch (error) {
        row.lastError = this.tools.getErrorMessage(error, '提醒调度确认失败');
        await manager.save(row);
        throw error;
      }
    });
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
   * 保存、列出或取消当前用户的提醒意图，只有统一计划确认后才返回已安排状态。
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
    const owner = this.owner(message);
    if (input.operation === 'list') {
      const rows = await this.store.list(owner);
      const daily = [];
      const jobs = [];
      for (const row of rows) {
        let nextRunAt: string | null = null;
        let status: string = row.status;
        if (row.scheduleId && row.status === 'scheduled') {
          if (!this.scheduler) status = 'unavailable';
          else {
            const state = await this.scheduler.read(row.scheduleId);
            if (!state.enabled) status = 'disabled';
            else nextRunAt = state.nextRunAt;
          }
        }
        const item = {
          id: row.id,
          text: row.data.text,
          variants: row.data.variants || [],
          platformId: row.data.platformId,
          dueAt: row.data.dueAt,
          status,
          error: row.lastError || '',
        };
        if (row.data.repeat && row.status !== 'cancelled')
          daily.push({
            ...item,
            nextRunAt,
            pattern: row.data.repeat,
            timezone: 'Asia/Shanghai',
          });
        else jobs.push(item);
      }
      return {
        daily,
        jobs,
      };
    }
    if (input.operation === 'delete') {
      const id = String(input.id || '');
      if (!id.startsWith(owner + '-'))
        throw new Error('提醒不属于当前发起人与会话');
      await this.store.withReminder(id, async (row, manager) => {
        if (row.owner !== owner) throw new Error('提醒不属于当前发起人与会话');
        row.status = 'cancelled';
        row.syncPending = true;
        await manager.save(row);
      });
      await this.synchronize(id);
      return { cancelled: true };
    }
    if (input.operation !== 'create') throw new Error('提醒动作无效');
    if (!this.scheduler) throw new Error('提醒调度尚未装配');
    const text = String(input.text || '').trim();
    const dailyAt = String(input.dailyAt || '');
    const runAt = String(input.runAt || '');
    if (!text || text.length > 1200 || /\[CQ:|<(?:@|qqbot-)/iu.test(text))
      throw new Error('提醒正文应为1至1200字普通文本；真实提及请传platformId');
    const variants = this.normalizeVariants(input.variants);
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
    const data: BotReminderData = {
      owner,
      sourcePluginKey,
      text,
      variants,
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
    await this.store.create(id, data);
    await this.synchronize(id);
    const scheduled = await this.store.withReminder(id, async (row) =>
      this.scheduler!.read(row.scheduleId!),
    );
    return {
      id,
      status: 'scheduled',
      platformId,
      nextRunAt: scheduled.nextRunAt,
      variants,
      timezone: 'Asia/Shanghai',
      delivery:
        '执行时检查权限并记录发送结果；平台拒绝会记为失败，不冒充已送达',
    };
  }

  /**
   * 到期重新检查发起人和 Bot 绑定，再通过统一发送服务投递，平台拒绝时保留失败任务。
   * @param data - Bot 自己保存的最小投递信息。
   * @param occurredAt - 触发器已持久化的本次计划时间。
   * @returns 统一发送服务返回的投递结果。
   * @throws 权限、绑定或成员标识无效时拒绝发送；平台拒绝时保留其实际错误原因。
   */
  async deliver(
    data: BotReminderData,
    occurredAt = data.dueAt,
  ): Promise<unknown> {
    const message = data.message;
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
    if (!data.sourcePluginKey || !pluginKeys.includes(data.sourcePluginKey))
      throw new Error('提醒来源插件绑定已撤销');
    let text = this.occurrenceText(data, occurredAt);
    const platformId = data.platformId;
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
    try {
      return await this.send.sendText({
        selfId: message.selfId,
        targetType: message.messageType,
        targetId: message.targetId,
        channelId: message.channelId,
        guildId: message.guildId,
        message: text,
      });
    } catch (error) {
      throw new Error(this.tools.getErrorMessage(error, '提醒投递失败'));
    }
  }

  /**
   * 到期读取本领域状态并发送，取消意图先于发送检查，未知发送结果由执行模块阻止自动重试。
   * @param id - 调度输入中的提醒身份。
   * @param occurredAt - 已持久化的触发时刻，文案轮换不依赖本机当前日期。
   * @param signal - 执行模块传入的取消或超时信号。
   * @throws 取消、权限或发送失败时保留错误并让执行模块记录失败。
   */
  async execute(
    id: string,
    occurredAt: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.store.withReminder(id, async (row, manager) => {
      if (row.status === 'cancelled' || signal.aborted)
        throw new Error('提醒已取消');
      if (
        !row.data.repeat &&
        (row.status === 'succeeded' || row.status === 'failed')
      )
        throw new Error('一次性提醒已执行，不能重复发送');
      try {
        await this.deliver(row.data, occurredAt);
        if (!row.data.repeat) row.status = 'succeeded';
        row.lastError = null;
        await manager.save(row);
      } catch (error) {
        if (!row.data.repeat) row.status = 'failed';
        row.lastError = this.tools.getErrorMessage(error, '提醒投递失败');
        await manager.save(row);
        throw error;
      }
    });
  }

  /**
   * 校验可轮换文案，逐项拒绝内嵌提及标签，成员身份仍由独立字段控制。
   * @param value - 创建提醒时提供的可选文案数组。
   * @returns 去重后的文案；未指定时为空数组并保留固定正文。
   * @throws 数量、类型、长度或内容不合法时拒绝保存提醒。
   */
  private normalizeVariants(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 24)
      throw new Error('提醒轮换文案应为最多24条普通文本');
    const result: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string')
        throw new Error('每条提醒轮换文案应为1至1200字普通文本');
      const text = item.trim();
      if (!text || text.length > 1200 || /\[CQ:|<(?:@|qqbot-)/iu.test(text))
        throw new Error('每条提醒轮换文案应为1至1200字普通文本');
      if (!result.includes(text)) result.push(text);
    }
    if (result.length === 1) throw new Error('轮换提醒至少需要两条不同文案');
    return result;
  }

  /**
   * 依据持久化计划时刻选择当次文案，同一天重试保持相同内容，不依赖进程内计数。
   * @param data - 包含首次到期时间和轮换文案的业务记录。
   * @param occurredAt - 本次已持久化的触发时间。
   * @returns 本次应投递的普通文本，未配置轮换时返回固定正文。
   */
  private occurrenceText(data: BotReminderData, occurredAt: string): string {
    const variants = data.variants || [];
    if (!variants.length) return data.text;
    const first = Date.parse(data.dueAt);
    const scheduled = Date.parse(occurredAt);
    if (!data.repeat || !Number.isFinite(scheduled) || !Number.isFinite(first))
      return variants[0];
    const days = Math.max(0, Math.round((scheduled - first) / 86400000));
    return variants[days % variants.length];
  }
}
