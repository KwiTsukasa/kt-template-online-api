import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SYSTEM_NOTICE_PUBLISHER,
  SystemNoticePublisher,
  ToolsService,
} from '@/common';
import { QQBOT_MQTT_TOPICS } from '../../contract/qqbot.constants';
import { QqbotDedupeService } from '../dedupe/qqbot-dedupe.service';
import { QqbotMessageService } from '../message/qqbot-message.service';
import { QqbotBusService } from '../../infrastructure/integration/bus/qqbot-bus.service';
import type { QqbotOneBotEvent } from '../../contract/qqbot.types';
import {
  buildDedupeKey,
  getOneBotOfflineReason,
  isOneBotMessageEvent,
  normalizeOneBotMessage,
} from '../../domain/event/qqbot-event-normalizer';
import { QqbotRuleEngineService } from '../rule/qqbot-rule-engine.service';
import { QqbotAccountService } from '../account/qqbot-account.service';

@Injectable()
export class QqbotEventService {
  private readonly logger = new Logger(QqbotEventService.name);

  constructor(
    private readonly busService: QqbotBusService,
    private readonly dedupeService: QqbotDedupeService,
    private readonly messageService: QqbotMessageService,
    private readonly ruleEngineService: QqbotRuleEngineService,
    private readonly toolsService: ToolsService,
    private readonly accountService: QqbotAccountService,
    @Optional()
    @Inject(SYSTEM_NOTICE_PUBLISHER)
    private readonly systemNoticePublisher?: SystemNoticePublisher,
  ) {}

  /**
   * 通过 `busService.publish` 发布领域状态。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `self_id` 字段。
   */
  async handleIncoming(payload: QqbotOneBotEvent) {
    const selfId = `${payload.self_id || ''}`;
    if (selfId) {
      await this.busService.publish(
        QQBOT_MQTT_TOPICS.eventRaw(selfId),
        payload,
      );
    }

    if (!isOneBotMessageEvent(payload)) {
      await this.handleRuntimeNotice(selfId, payload);
      return;
    }
    const message = normalizeOneBotMessage(payload, this.toolsService);
    if (!message.selfId || !message.targetId || !message.userId) {
      this.logger.warn('QQBot 收到缺少关键字段的消息事件，已忽略');
      return;
    }

    const claimed = await this.dedupeService.claim(buildDedupeKey(message));
    if (!claimed) return;

    await this.messageService.saveIncoming(message);
    await this.busService.publish(
      QQBOT_MQTT_TOPICS.eventMessage(message.selfId),
      message,
    );
    await this.ruleEngineService.handleMessage(message);
  }

  /**
   * 根据`selfId`、`payload`处理运行态通知；从 `getOneBotOfflineReason` 读取运行态通知。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   */
  private async handleRuntimeNotice(selfId: string, payload: QqbotOneBotEvent) {
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
    payload: QqbotOneBotEvent,
  ) {
    if (!this.systemNoticePublisher) return;

    void this.systemNoticePublisher
      .publishSystemNotice({
        content: offlineReason,
        dedupeKey: `qqbot:offline:${selfId}`,
        eventType: 'qqbot.account.offline',
        metadata: {
          payload,
          selfId,
        },
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'qqbot',
        summary: offlineReason,
        title: `QQBot 账号已下线：${selfId}`,
      })
      .catch(() => undefined);
  }
}
