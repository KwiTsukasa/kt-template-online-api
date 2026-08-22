import { createHash } from 'node:crypto';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ToolsService } from '@/common';
import {
  BotAdapterRegistry,
  type BotAdapterProtocol,
  type BotDeliveryRequest,
} from '@/modules/bot';
import { normalizeOneBotMessage } from '@/modules/bot-adapter/core/domain/event/bot-event-normalizer';
import type { BotOneBotEvent } from '@/modules/bot-adapter/core/contract/bot.types';
import {
  BotReverseWsActionError,
  BotReverseWsService,
} from '@/modules/bot-adapter/core/infrastructure/integration/connection/bot-reverse-ws.service';

@Injectable()
export class NapcatBotProtocolAdapter
  implements BotAdapterProtocol, OnModuleDestroy, OnModuleInit
{
  readonly key = 'napcat';

  constructor(
    private readonly registry: BotAdapterRegistry,
    private readonly reverseWsService: BotReverseWsService,
    private readonly toolsService: ToolsService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  onModuleDestroy() {
    this.registry.unregister(this.key);
  }

  /**
   * 将 OneBot 入站事件适配为平台无关 Bot 信封，并把平台身份收敛为不可逆 opaque 键。
   * @param payload - OneBot 原始事件。
   * @returns 单条标准 Bot 入站信封。
   */
  async normalize(payload: unknown) {
    const message = normalizeOneBotMessage(
      payload as BotOneBotEvent,
      this.toolsService,
    );
    return [
      {
        adapterKey: this.key,
        conversationKey: opaqueKey([
          message.selfId,
          message.messageType,
          message.targetId,
        ]),
        eventKey: message.messageId,
        metadata: {},
        scope: toBotScope(message.messageType),
        senderKey: opaqueKey([message.selfId, message.userId]),
        text: message.messageText,
      },
    ];
  }

  /**
   * 将平台无关文本意图适配为 OneBot 私聊、群聊或频道动作并经当前反向连接发送。
   * @param request - 包含连接键、目标键、作用域和文本意图的标准投递请求。
   * @returns 标准投递结果及只供审计的原始响应。
   * @throws OneBot 返回非成功状态时抛出错误。
   */
  async deliver(request: BotDeliveryRequest) {
    const action = buildOneBotAction(request.scope);
    const params = buildOneBotParams(request);
    const response = await this.reverseWsService.sendAction(
      request.connectionKey,
      action,
      params,
    );
    if (response.status !== 'ok' || response.retcode !== 0) {
      throw new BotReverseWsActionError(
        'onebot_rejected',
        response.message || 'NapCat OneBot rejected delivery',
      );
    }
    return {
      deliveredAt: new Date().toISOString(),
      deliveryKey: `${response.data?.message_id || ''}`,
      raw: response,
    };
  }
}

/**
 * 将 Bot 作用域转换为 OneBot 发送动作。
 * @param scope - 平台无关会话作用域。
 * @returns OneBot 动作名。
 */
function buildOneBotAction(scope: BotDeliveryRequest['scope']) {
  if (scope === 'direct') return 'send_private_msg';
  if (scope === 'group') return 'send_group_msg';
  return 'send_guild_channel_msg';
}

/**
 * 将标准投递请求转换为 OneBot 动作参数，并保持正文为文本段。
 * @param request - 标准投递请求。
 * @returns OneBot 动作参数。
 */
function buildOneBotParams(request: BotDeliveryRequest) {
  const message = resolveOneBotMessage(request);
  if (request.scope === 'direct') {
    return { message, user_id: request.targetKey };
  }
  if (request.scope === 'group') {
    return { group_id: request.targetKey, message };
  }
  const context = request.adapterContext as
    | { channelId?: string; guildId?: string }
    | undefined;
  return {
    channel_id: context?.channelId || request.targetKey,
    guild_id: context?.guildId || '',
    message,
  };
}

/**
 * 优先复用核心已构造的 OneBot 字符串或消息段，使 CQ 图片和 @ 提及保持协议语义；上下文缺失或非法时回退纯文本段。
 * @param request - 标准投递请求及只供具体适配器解释的动作上下文。
 * @returns 可直接传给 OneBot `message` 字段的字符串或受控消息段数组。
 */
function resolveOneBotMessage(request: BotDeliveryRequest) {
  const context = request.adapterContext as
    | { actionParams?: Record<string, unknown> }
    | undefined;
  const candidate = context?.actionParams?.message;
  if (typeof candidate === 'string') return candidate;
  if (Array.isArray(candidate) && candidate.every(isOneBotSegment)) {
    return candidate;
  }
  return [{ data: { text: request.intent.content }, type: 'text' }];
}

/**
 * 仅接受带字符串 `type` 和普通对象 `data` 的 OneBot 消息段，阻止任意适配器上下文原样进入协议发送。
 * @param value - 待校验的消息段候选。
 * @returns 候选符合最小 OneBot 消息段结构时返回 true。
 */
function isOneBotSegment(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || !record.type) return false;
  if (!record.data || typeof record.data !== 'object') return false;
  return !Array.isArray(record.data);
}

/**
 * 将适配器身份片段哈希为稳定 opaque 键。
 * @param parts - 原始平台身份片段。
 * @returns 六十四位十六进制键。
 */
function opaqueKey(parts: string[]) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

/**
 * 将适配器核心消息类型映射为无状态 Bot 作用域。
 * @param messageType - 适配器核心消息类型。
 * @returns 平台无关作用域。
 */
function toBotScope(messageType: 'channel' | 'group' | 'private') {
  if (messageType === 'private') return 'direct' as const;
  if (messageType === 'group') return 'group' as const;
  return 'channel' as const;
}
