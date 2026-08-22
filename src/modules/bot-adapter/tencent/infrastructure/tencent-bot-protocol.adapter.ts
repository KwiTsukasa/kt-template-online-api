import { createHash } from 'node:crypto';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  BotAdapterRegistry,
  type BotAdapterProtocol,
  type BotDeliveryRequest,
} from '@/modules/bot';
import { TencentBotService } from './tencent-bot.service';

@Injectable()
export class TencentBotProtocolAdapter
  implements BotAdapterProtocol, OnModuleDestroy, OnModuleInit
{
  readonly key = 'tencent';

  constructor(
    private readonly registry: BotAdapterRegistry,
    private readonly tencentService: TencentBotService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  onModuleDestroy() {
    this.registry.unregister(this.key);
  }

  /**
   * 将 Tencent SDK 的统一消息形态转换为无状态 Bot 信封，调用方仍负责官方签名与事件分发。
   * @param payload - Tencent SDK 统一消息。
   * @returns 可由 Bot 协议层路由的单条信封；关键字段缺失时返回空数组。
   */
  async normalize(payload: unknown) {
    if (!payload || typeof payload !== 'object') return [];
    const record = payload as Record<string, unknown>;
    const messageId = `${record.messageId || ''}`;
    const senderId = `${record.senderId || ''}`;
    const targetId = `${record.targetId || record.groupOpenid || senderId}`;
    if (!messageId || !senderId || !targetId) return [];
    return [
      {
        adapterKey: this.key,
        conversationKey: opaqueKey([`${record.accountKey || ''}`, targetId]),
        eventKey: messageId,
        metadata: {},
        replyContext: record.replyTarget,
        scope: resolveScope(record.kind),
        senderKey: opaqueKey([senderId]),
        text: `${record.content || ''}`,
      },
    ];
  }

  /**
   * 将标准 Bot 文本意图适配为 Tencent C2C、群、频道或频道私信发送。
   * @param request - 标准投递请求及 opaque Tencent 回复上下文。
   * @returns 标准投递结果与官方原始响应。
   */
  async deliver(request: BotDeliveryRequest) {
    const context = request.adapterContext as
      | {
          channelId?: string;
          guildId?: string;
          replyMessageId?: string;
        }
      | undefined;
    const response = await this.tencentService.sendText({
      adapterReplyContext: request.replyContext,
      channelId: context?.channelId,
      guildId: context?.guildId,
      message: request.intent.content,
      replyMessageId: context?.replyMessageId,
      selfId: request.connectionKey,
      targetId: request.targetKey,
      targetType: toAdapterTargetType(request.scope),
    });
    return {
      deliveredAt: `${response.timestamp}`,
      deliveryKey: response.id,
      raw: response,
    };
  }
}

/**
 * 将 Tencent 消息类别映射为平台无关作用域。
 * @param kind - SDK 消息类别。
 * @returns 标准 Bot 作用域。
 */
function resolveScope(kind: unknown) {
  if (kind === 'c2c' || kind === 'dm') return 'direct' as const;
  if (kind === 'group') return 'group' as const;
  return 'channel' as const;
}

/**
 * 将标准 Bot 作用域映射为适配器核心目标类型。
 * @param scope - 标准 Bot 作用域。
 * @returns 适配器发送目标类型。
 */
function toAdapterTargetType(scope: BotDeliveryRequest['scope']) {
  if (scope === 'direct') return 'private' as const;
  if (scope === 'group') return 'group' as const;
  return 'channel' as const;
}

/**
 * 将 Tencent 身份片段哈希为稳定 opaque 键。
 * @param parts - 原始身份片段。
 * @returns 六十四位十六进制键。
 */
function opaqueKey(parts: string[]) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}
