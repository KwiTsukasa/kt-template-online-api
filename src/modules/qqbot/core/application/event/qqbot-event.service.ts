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

  /**
   * 初始化 QqbotEventService 实例。
   * @param busService - busService 服务依赖；影响 constructor 的返回值。
   * @param dedupeService - dedupeService 服务依赖；影响 constructor 的返回值。
   * @param messageService - messageService 服务依赖；影响 constructor 的返回值。
   * @param ruleEngineService - ruleEngineService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param accountService - accountService 服务依赖；影响 constructor 的返回值。
   * @param systemNoticePublisher - systemNoticePublisher 输入；影响 constructor 的返回值。
   */
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
   * 处理Incoming。
   * @param payload - payload 输入；使用 `self_id` 字段生成结果。
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
   * 处理Runtime Notice。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param payload - payload 输入；驱动 `getOneBotOfflineReason()`、`this.publishOfflineNotice()` 的 QQBot步骤。
   */
  private async handleRuntimeNotice(selfId: string, payload: QqbotOneBotEvent) {
    if (!selfId) return;
    const offlineReason = getOneBotOfflineReason(payload);
    if (!offlineReason) return;
    await this.accountService.markQqLoginOffline(selfId, offlineReason);
    this.publishOfflineNotice(selfId, offlineReason, payload);
  }

  /**
   * 投递 QQBot 核心消息或任务。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param offlineReason - offlineReason 输入；影响 publishOfflineNotice 的返回值。
   * @param payload - payload 输入；影响 publishOfflineNotice 的返回值。
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
