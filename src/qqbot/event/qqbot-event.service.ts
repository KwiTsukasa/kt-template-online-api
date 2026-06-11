import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SYSTEM_NOTICE_PUBLISHER,
  SystemNoticePublisher,
  ToolsService,
} from '@/common';
import { QQBOT_MQTT_TOPICS } from '../qqbot.constants';
import { QqbotDedupeService } from '../dedupe/qqbot-dedupe.service';
import { QqbotMessageService } from '../message/qqbot-message.service';
import { QqbotBusService } from '../mqtt/qqbot-bus.service';
import type { QqbotOneBotEvent } from '../qqbot.types';
import {
  buildDedupeKey,
  getOneBotOfflineReason,
  isOneBotMessageEvent,
  normalizeOneBotMessage,
} from './qqbot-event-normalizer';
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

  private async handleRuntimeNotice(
    selfId: string,
    payload: QqbotOneBotEvent,
  ) {
    if (!selfId) return;
    const offlineReason = getOneBotOfflineReason(payload);
    if (!offlineReason) return;
    await this.accountService.markOffline(selfId, offlineReason);
    this.publishOfflineNotice(selfId, offlineReason, payload);
  }

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
