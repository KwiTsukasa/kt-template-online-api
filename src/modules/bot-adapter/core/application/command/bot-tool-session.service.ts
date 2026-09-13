import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { BotAdapterRegistry } from '@/modules/bot';
import { BotAccountService } from '../account/bot-account.service';
import { BotTaskStoreService } from '../message/bot-task-store.service';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import type { BotAdapterExecutionContext } from '../../domain/bot-adapter-execution-context';
import { BotPermissionService } from '../permission/bot-permission.service';
import { BotCommandEngineService } from './bot-command-engine.service';
import { BotChatHistoryService } from '../message/bot-chat-history.service';
import { BotReminderService } from '../message/bot-reminder.service';
import { BotSendService } from '../send/bot-send.service';
import { BotArtifactService } from '../message/bot-artifact.service';
import { describeToolResult, readToolResultPage } from './bot-tool-result';

type ToolTurn = {
  message: BotNormalizedMessage;
  adapterContext?: BotAdapterExecutionContext;
  expiresAt: number;
  calls: Map<string, Promise<unknown>>;
  closed: boolean;
  durableId?: string;
  sourcePluginKey: string;
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
    @Optional() private readonly artifacts?: BotArtifactService,
    @Optional() private readonly store?: BotTaskStoreService,
    @Optional() private readonly adapters?: BotAdapterRegistry,
    @Optional() private readonly accounts?: BotAccountService,
  ) {}

  /**
   * 为已授权的真实入站消息建立短期工具上下文，不把平台身份交给模型选择。
   * @param message - 经过去重与权限检查的原始消息。
   * @param sourcePluginKey - 宿主确认的当前调用插件。
   * @param adapterContext - 当前适配器的授权刷新入口。
   * @returns 仅在本次处理期间有效的随机上下文标识。
   */
  open(
    message: BotNormalizedMessage,
    sourcePluginKey: string,
    adapterContext?: BotAdapterExecutionContext,
  ) {
    for (const [key, turn] of this.turns) {
      if (turn.expiresAt <= Date.now()) this.turns.delete(key);
    }
    const id = randomUUID();
    this.turns.set(id, {
      message,
      sourcePluginKey,
      adapterContext,
      // 覆盖事件执行 920 秒及宿主队列 120 秒；完成时仍立即撤销，每次工具调用重查权限。
      expiresAt: Date.now() + 1_050_000,
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
   * 将真实发起人和固定过期时间持久保存，后台任务重启不更换工具授权标识。
   * @param id - 入队时生成的随机标识。
   * @param message - 已通过入站权限检查的消息。
   * @param expiresAt - 本次任务的最晚有效时间，恢复时不得延长。
   * @param sourcePluginKey - 宿主确认的调用插件，随任务持久化。
   * @throws 持久存储不可用时拒绝启动后台工具调用。
   */
  async openDurable(
    id: string,
    message: BotNormalizedMessage,
    expiresAt: number,
    sourcePluginKey: string,
  ): Promise<void> {
    if (!this.store) throw new Error('后台工具授权存储未就绪');
    await this.store.write(
      `turn:${id}`,
      { message, expiresAt, sourcePluginKey },
      Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
    );
  }

  /**
   * 在后台推理结束后撤销持久授权，已完成的工具结果仍保留供审计。
   * @param id - 需要撤销的固定任务授权。
   */
  async closeDurable(id: string): Promise<void> {
    this.close(id);
    await this.store?.write(`turn:${id}`, { expiresAt: 0 }, 86400);
  }

  /**
   * 按持久任务恢复真实发起人，并通过适配器重新绑定实时权限和会话读取能力。
   * @param id - Hermes 元数据携带的随机授权标识。
   * @returns 尚未过期的工具上下文，不存在或已撤销时为空。
   */
  private async restore(id: string): Promise<ToolTurn | undefined> {
    if (!this.store) return undefined;
    const saved = await this.store.read(`turn:${id}`);
    if (
      !saved?.message ||
      !saved.sourcePluginKey ||
      saved.expiresAt <= Date.now()
    )
      return undefined;
    const message = {
      ...saved.message,
      eventTime: new Date(saved.message.eventTime),
    } as BotNormalizedMessage;
    let refreshPluginKeys = async () =>
      this.accounts?.getBoundEventPluginKeys(message.selfId) || [];
    let readPlatformApi: BotAdapterExecutionContext['readPlatformApi'];
    if (message.connectionMode !== 'reverse-ws') {
      const adapter = this.adapters?.require('tencent');
      refreshPluginKeys = async () =>
        adapter?.listBoundPluginKeys?.(message.selfId) || [];
      if (adapter?.readConversationApi)
        readPlatformApi = (input) =>
          adapter.readConversationApi!({
            ...input,
            connectionKey: message.selfId,
            targetKey: message.targetId,
            guildId: message.guildId,
            channelId: message.channelId,
          });
    }
    const turn: ToolTurn = {
      message,
      expiresAt: saved.expiresAt,
      calls: new Map(),
      closed: false,
      durableId: id,
      sourcePluginKey: saved.sourcePluginKey,
      adapterContext: {
        pluginKeys: await refreshPluginKeys(),
        refreshPluginKeys,
        readPlatformApi,
      },
    };
    const existing = this.turns.get(id);
    if (existing) return existing;
    this.turns.set(id, turn);
    return turn;
  }

  /**
   * 为后台任务的副作用保存执行凭证；中断时返回待核实状态而不重复操作。
   * @param turn - 已验证的消息授权。
   * @param key - 操作参数序列化后的键。
   * @param execute - 首次占有执行权后运行的实际操作。
   * @returns 首次操作或之前保存的真实结果。
   * @throws 前次操作结果未知或已失败时要求核实，防止重复副作用。
   */
  private async durableCall(
    turn: ToolTurn,
    key: string,
    execute: () => Promise<unknown>,
  ): Promise<unknown> {
    if (!turn.durableId || !this.store) return execute();
    const storageKey = `call:${turn.durableId}:${createHash('sha256').update(key).digest('hex')}`;
    if (!(await this.store.reserve(storageKey))) {
      const saved = await this.store.read(storageKey);
      if (saved?.status === 'completed') return saved.value;
      throw new Error(
        '前次操作的执行结果尚未确认，禁止重复执行，请先查询实际状态',
      );
    }
    const counter = `kt:bot:tasks:call-count:${turn.durableId}`;
    const count = await this.store.redis!.incr(counter);
    await this.store.redis!.expire(counter, 86400);
    if (count > 8) throw new Error('本任务命令调用次数已达上限');
    const value = await execute();
    await this.store.write(storageKey, { status: 'completed', value });
    return value;
  }

  /**
   * 重新验证当前身份与插件绑定后列出命令，或幂等执行目录内的完整命令文本。
   * @param id - 由 Hermes 执行层元数据携带的上下文标识。
   * @param input - 仅包含工具动作、命令标识及完整文本的请求。
   * @returns 可用命令目录或命令运行结果。
   * @throws 上下文过期、身份权限撤销、参数无效或调用次数超限时拒绝执行。
   */
  async call(id: string, input: Record<string, unknown>): Promise<unknown> {
    const turn = this.turns.get(id) || (await this.restore(id));
    if (!turn || turn.expiresAt <= Date.now())
      throw new Error('当前消息工具授权已失效');
    if (turn.durableId) {
      const saved = await this.store?.read(`turn:${turn.durableId}`);
      if (!saved?.message || saved.expiresAt <= Date.now()) {
        this.close(id);
        throw new Error('当前消息工具授权已失效');
      }
    }
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
    if (
      context?.pluginKeys &&
      !context.pluginKeys.includes(turn.sourcePluginKey)
    )
      throw new Error('当前Bot的调用插件授权已撤销');
    if (input.action === 'history') {
      if (!this.history) throw new Error('同群历史服务未就绪');
      return this.history.read(turn.message, input);
    }
    if (input.action === 'image') {
      if (!this.artifacts) throw new Error('历史图片服务未就绪');
      return this.artifacts.readImage(turn.message, input);
    }
    if (input.action === 'tasks') {
      if (!this.store) throw new Error('后台任务查询未就绪');
      return this.store.listTasks(turn.message);
    }
    if (input.action === 'result') {
      if (
        !this.store ||
        typeof input.resultId !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(input.resultId)
      )
        throw new Error('命令结果标识无效');
      const saved = await this.store.read(`result:${id}:${input.resultId}`);
      if (!saved) throw new Error('当前消息没有这个命令结果或结果已过期');
      return readToolResultPage(saved.value, input);
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
      if (input.action === 'reminder' && input.operation === 'list') {
        return this.runChatAction(turn, input);
      }
      const key = JSON.stringify(input);
      const previous = turn.calls.get(key);
      if (previous) return previous;
      if (turn.calls.size >= 8) throw new Error('本轮工具调用次数已达上限');
      const result = this.durableCall(turn, key, () =>
        this.runChatAction(turn, input),
      );
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
    if (
      await this.commands.isReadOnlyForTools(
        turn.message,
        context,
        input.commandId,
      )
    ) {
      return this.presentResult(
        id,
        await this.commands.executeForTools(
          turn.message,
          context,
          input.commandId,
          input.text,
        ),
      );
    }
    const key = JSON.stringify([input.commandId, input.text]);
    const previous = turn.calls.get(key);
    if (previous) return this.presentResult(id, await previous);
    if (turn.calls.size >= 8) throw new Error('本轮命令调用次数已达上限');
    const commandId = input.commandId;
    const text = input.text;
    const result = this.durableCall(turn, key, () =>
      this.commands.executeForTools(turn.message, context, commandId, text),
    );
    turn.calls.set(key, result);
    return this.presentResult(id, await result);
  }

  /**
   * 长命令结果按授权身份持久保存并返回读取入口，小结果保留原有协议。
   * @param id - 当前消息的授权标识，模型不能覆盖。
   * @param value - 命令执行返回的完整结果。
   * @returns 原始小结果或带字段摘要的长结果引用。
   * @throws 长结果持久层不可用时拒绝产生无法读取的文件占位符。
   */
  private async presentResult(id: string, value: unknown): Promise<unknown> {
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized) <= 12000) return value;
    if (!this.store) throw new Error('长命令结果存储未就绪');
    const resultId = createHash('sha256').update(serialized).digest('hex');
    await this.store.write(`result:${id}:${resultId}`, { value }, 3600);
    return {
      kind: 'paged_result',
      resultId,
      bytes: Buffer.byteLength(serialized),
      structure: describeToolResult(value),
      readTool: 'kt_command_result',
      instruction:
        '使用字段路径读取完整结果；text为JSON片段，nextOffset非空时可继续读取，无需再次执行命令。',
    };
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
      return this.reminders.manage(turn.message, input, turn.sourcePluginKey);
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
