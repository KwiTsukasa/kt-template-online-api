import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SYSTEM_NOTICE_PUBLISHER,
  SystemNoticePublisher,
  ToolsService,
} from '@/common';
import { BOT_MQTT_TOPICS } from '../../contract/bot.constants';
import { BotDedupeService } from '../dedupe/bot-dedupe.service';
import { BotMessageService } from '../message/bot-message.service';
import { BotBusService } from '../../infrastructure/integration/bus/bot-bus.service';
import type {
  BotNormalizedMessage,
  BotOneBotEvent,
} from '../../contract/bot.types';
import type { BotAdapterExecutionContext } from '../../domain/bot-adapter-execution-context';
import {
  buildDedupeKey,
  getOneBotOfflineReason,
  isOneBotMessageEvent,
  normalizeOneBotMessage,
} from '../../domain/event/bot-event-normalizer';
import { BotRuleEngineService } from '../send/bot-rule-engine.service';
import { BotAccountService } from '../account/bot-account.service';

@Injectable()
export class BotEventService {
  private readonly logger = new Logger(BotEventService.name);

  constructor(
    private readonly busService: BotBusService,
    private readonly dedupeService: BotDedupeService,
    private readonly messageService: BotMessageService,
    private readonly ruleEngineService: BotRuleEngineService,
    private readonly toolsService: ToolsService,
    private readonly accountService: BotAccountService,
    @Optional()
    @Inject(SYSTEM_NOTICE_PUBLISHER)
    private readonly systemNoticePublisher?: SystemNoticePublisher,
  ) {}

  /**
   * 通过 `busService.publish` 发布领域状态。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `self_id` 字段。
   */
  async handleIncoming(payload: BotOneBotEvent) {
    const selfId = `${payload.self_id || ''}`;
    if (selfId) await this.handleRawEvent(selfId, payload);

    if (!isOneBotMessageEvent(payload)) {
      await this.handleRuntimeNotice(selfId, payload);
      return;
    }
    const message = normalizeOneBotMessage(payload, this.toolsService);
    await this.handleNormalizedMessage(message);
  }

  /**
   * 发布任意 Bot transport 的脱敏原始事件，保持 MQTT 与本地总线观察入口一致。
   * @param selfId - 当前事件归属的稳定 Bot 账号键。
   * @param payload - OneBot 或 QQ 官方 SDK 的原始事件安全投影。
   */
  async handleRawEvent(selfId: string, payload: Record<string, unknown>) {
    await this.busService.publish(BOT_MQTT_TOPICS.eventRaw(selfId), payload);
  }

  /**
   * 将任意 transport 已归一化的消息送入统一去重、消息持久化、总线和规则/命令/插件链。
   * @param message - 已完成账号、会话、发送者、正文和回复上下文映射的消息。
   * @param adapterContext - 当前 transport 的插件授权上下文；缺省时保持核心消息链可用。
   */
  async handleNormalizedMessage(
    message: BotNormalizedMessage,
    adapterContext?: BotAdapterExecutionContext,
  ) {
    if (!message.selfId || !message.targetId || !message.userId) {
      this.logger.warn('Bot 收到缺少关键字段的消息事件，已忽略');
      return;
    }

    const claimed = await this.dedupeService.claim(buildDedupeKey(message));
    if (!claimed) return;

    await this.messageService.saveIncoming(message);
    await this.busService.publish(
      BOT_MQTT_TOPICS.eventMessage(message.selfId),
      message,
    );
    await this.ruleEngineService.handleMessage(message, adapterContext);
  }

  /**
   * 根据`selfId`、`payload`处理运行态通知；从 `getOneBotOfflineReason` 读取运行态通知。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   */
  private async handleRuntimeNotice(selfId: string, payload: BotOneBotEvent) {
    if (!selfId) return;
    const offlineReason = getOneBotOfflineReason(payload);
    if (!offlineReason) return;
    await this.accountService.markQqLoginOffline(selfId, offlineReason);
    this.publishOfflineNotice(selfId, offlineReason, payload);
  }

  /**
   * 按账号发布可去重的离线系统通知，并保留原始 OneBot 事件作为通知元数据。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param offlineReason - 决定Offline通知内容、边界或目标的 `offlineReason` 值。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   */
  private publishOfflineNotice(
    selfId: string,
    offlineReason: string,
    payload: BotOneBotEvent,
  ) {
    if (!this.systemNoticePublisher) return;

    void this.systemNoticePublisher
      .publishSystemNotice({
        content: offlineReason,
        dedupeKey: `bot:offline:${selfId}`,
        eventType: 'bot.account.offline',
        metadata: {
          payload,
          selfId,
        },
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'bot',
        summary: offlineReason,
        title: `Bot 账号已下线：${selfId}`,
      })
      .catch(() => undefined);
  }
}
