import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import type { BotAdapterExecutionContext } from '../../domain/bot-adapter-execution-context';
import { BotPermissionService } from '../permission/bot-permission.service';
import { BotCommandEngineService } from './bot-command-engine.service';
import { BotChatHistoryService } from '../message/bot-chat-history.service';
import { BotReminderService } from '../message/bot-reminder.service';
import { BotSendService } from '../send/bot-send.service';

type ToolTurn = {
  message: BotNormalizedMessage;
  adapterContext?: BotAdapterExecutionContext;
  expiresAt: number;
  calls: Map<string, Promise<unknown>>;
  closed: boolean;
};

@Injectable()
export class BotToolSessionService {
  private readonly turns = new Map<string, ToolTurn>();

  constructor(
    private readonly permissions: BotPermissionService,
    private readonly commands: BotCommandEngineService,
    @Optional() private readonly history?: BotChatHistoryService,
    @Optional() private readonly reminders?: BotReminderService,
    @Optional() private readonly send?: BotSendService,
  ) {}

  /**
   * 为已授权的真实入站消息建立短期工具上下文，不把平台身份交给模型选择。
   * @param message - 经过去重与权限检查的原始消息。
   * @param adapterContext - 当前适配器的授权刷新入口。
   * @returns 仅在本次处理期间有效的随机上下文标识。
   */
  open(
    message: BotNormalizedMessage,
    adapterContext?: BotAdapterExecutionContext,
  ) {
    for (const [key, turn] of this.turns) {
      if (turn.expiresAt <= Date.now()) this.turns.delete(key);
    }
    const id = randomUUID();
    this.turns.set(id, {
      message,
      adapterContext,
      expiresAt: Date.now() + 240_000,
      calls: new Map(),
      closed: false,
    });
    return id;
  }

  /**
   * 在回复完成或失败后撤销工具上下文，后台残留推理不能继续执行命令。
   * @param id - 当前事件创建的上下文标识。
   */
  close(id: string) {
    const turn = this.turns.get(id);
    if (turn) turn.closed = true;
    this.turns.delete(id);
  }

  /**
   * 重新验证当前身份与插件绑定后列出命令，或幂等执行目录内的完整命令文本。
   * @param id - 由 Hermes 执行层元数据携带的上下文标识。
   * @param input - 仅包含工具动作、命令标识及完整文本的请求。
   * @returns 可用命令目录或命令运行结果。
   * @throws 上下文过期、身份权限撤销、参数无效或调用次数超限时拒绝执行。
   */
  async call(id: string, input: Record<string, unknown>): Promise<unknown> {
    const turn = this.turns.get(id);
    if (!turn || turn.expiresAt <= Date.now())
      throw new Error('当前消息工具授权已失效');
    if (
      (await this.permissions.isBlocked(turn.message)) ||
      !(await this.permissions.isAllowed(turn.message))
    ) {
      throw new Error('当前发送者没有命令运行权限');
    }
    let context = turn.adapterContext;
    if (context?.refreshPluginKeys) {
      context = { ...context, pluginKeys: await context.refreshPluginKeys() };
    }
    if (this.turns.get(id) !== turn || turn.expiresAt <= Date.now())
      throw new Error('当前消息已结束');
    if (context?.pluginKeys && !context.pluginKeys.includes('hermes-agent'))
      throw new Error('当前Bot的Hermes授权已撤销');
    if (input.action === 'history') {
      if (!this.history) throw new Error('同群历史服务未就绪');
      return this.history.read(turn.message, input);
    }
    if (input.action === 'platform_api') {
      if (
        !context?.readPlatformApi ||
        input.method !== 'GET' ||
        typeof input.path !== 'string'
      )
        throw new Error(
          '当前适配器只开放本会话官方资料读取；写操作请使用已授权的消息、提醒或命令工具',
        );
      return context.readPlatformApi({
        path: input.path,
        query: input.query as Record<string, string> | undefined,
      });
    }
    if (input.action === 'reminder' || input.action === 'mention') {
      const key = JSON.stringify(input);
      const previous = turn.calls.get(key);
      if (previous) return previous;
      if (turn.calls.size >= 8) throw new Error('本轮工具调用次数已达上限');
      const result = this.runChatAction(turn, input);
      turn.calls.set(key, result);
      return result;
    }
    if (input.action === 'list')
      return this.commands.listForTools(turn.message, context);
    if (
      input.action !== 'run' ||
      typeof input.commandId !== 'string' ||
      typeof input.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > 8000
    ) {
      throw new Error('命令参数无效');
    }
    // 同一轮相同命令文本只执行一次，模型或 HTTP 重试不会重复产生副作用。
    const key = JSON.stringify([input.commandId, input.text]);
    const previous = turn.calls.get(key);
    if (previous) return previous;
    if (turn.calls.size >= 8) throw new Error('本轮命令调用次数已达上限');
    const result = this.commands.executeForTools(
      turn.message,
      context,
      input.commandId,
      input.text,
    );
    turn.calls.set(key, result);
    return result;
  }

  /**
   * 通过宿主消息能力创建提醒或提及已确认群成员，目标和权限始终由当前消息绑定。
   * @param turn - 尚未失效的消息授权及发送上下文。
   * @param input - 模型提出的提醒或成员提及参数。
   * @returns 真实任务状态或发送结果。
   * @throws 能力未加载、目标身份未知或非群聊提及时拒绝执行。
   */
  private async runChatAction(
    turn: ToolTurn,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (input.action === 'reminder') {
      if (!this.reminders) throw new Error('提醒服务未就绪');
      return this.reminders.manage(turn.message, input, 'hermes-agent');
    }
    if (!this.history || !this.send || turn.message.messageType === 'private')
      throw new Error('当前会话不支持成员提及');
    const member = await this.history.requireMember(
      turn.message,
      String(input.platformId || ''),
    );
    if (turn.closed || turn.expiresAt <= Date.now())
      throw new Error('当前消息已结束');
    const text = String(input.text || '').trim();
    if (text.length > 1200 || /\[CQ:|<(?:@|qqbot-)/iu.test(text))
      throw new Error('提及正文无效');
    let tag = `<qqbot-at-user id="${member}" />`;
    if (turn.message.connectionMode === 'reverse-ws')
      tag = `[CQ:at,qq=${member}]`;
    return this.send.sendText({
      selfId: turn.message.selfId,
      targetType: turn.message.messageType,
      targetId: turn.message.targetId,
      channelId: turn.message.channelId,
      guildId: turn.message.guildId,
      adapterReplyContext: turn.message.adapterReplyContext,
      replyMessageId: turn.message.replyMessageId,
      message: `${tag} ${text}`.trim(),
    });
  }
}
