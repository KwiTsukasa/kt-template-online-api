import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { EnvironmentEventEnvelope } from '../../domain/environment-dashboard.types';

export interface EnvironmentEventBusOptions {
  clientId?: string;
  mode?: 'local' | 'mqtt';
  password?: string;
  topicPrefix?: string;
  url?: string;
  username?: string;
}

export type EnvironmentEventSubscriber = (
  event: EnvironmentEventEnvelope,
) => void;

@Injectable()
export class EnvironmentEventBusService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EnvironmentEventBusService.name);
  private readonly options: Required<
    Pick<EnvironmentEventBusOptions, 'clientId' | 'mode' | 'topicPrefix'>
  > &
    Omit<EnvironmentEventBusOptions, 'clientId' | 'mode' | 'topicPrefix'>;
  private readonly subscribers = new Set<EnvironmentEventSubscriber>();
  private client: MqttClient | null = null;

  constructor(@Optional() options: EnvironmentEventBusOptions = {}) {
    this.options = {
      clientId:
        options.clientId ||
        process.env.ENV_DASHBOARD_MQTT_CLIENT_ID ||
        'kt-template-online-api-environment',
      mode:
        options.mode ||
        (process.env.ENV_DASHBOARD_EVENT_BUS as 'local' | 'mqtt') ||
        'local',
      password: options.password || process.env.ENV_DASHBOARD_MQTT_PASSWORD,
      topicPrefix:
        options.topicPrefix ||
        process.env.ENV_DASHBOARD_MQTT_TOPIC_PREFIX ||
        'kt/env',
      url: options.url || process.env.ENV_DASHBOARD_MQTT_URL,
      username: options.username || process.env.ENV_DASHBOARD_MQTT_USERNAME,
    };
  }

  onModuleInit() {
    if (this.options.mode !== 'mqtt') return;
    if (!this.options.url) {
      this.emitLocal(this.createBrokerStatusEvent('MQTT broker unwired'));
      return;
    }

    this.client = mqtt.connect(this.options.url, {
      clientId: this.options.clientId,
      password: this.options.password,
      username: this.options.username,
    });
    this.client.subscribe(`${this.options.topicPrefix}/#`);
    this.client.on('message', this.handleMqttMessage.bind(this));
    this.client.on('close', this.handleMqttClose.bind(this));
    this.client.on('error', this.handleMqttError.bind(this));
  }

  async onModuleDestroy() {
    if (!this.client) return;
    await new Promise<void>((resolve) => {
      this.client?.end(false, {}, () => resolve());
    });
  }

  /**
   * 按`subscriber`启动环境事件总线记录。
   * @param subscriber - 决定环境事件总线记录内容、边界或目标的 `subscriber` 值。
   * @returns 环境事件总线记录。
   */
  subscribe(subscriber: EnvironmentEventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * 按`event`投递环境事件总线记录；向目标通道投递结果（`client.publish`）。
   * @param event - 触发环境事件总线记录的领域事件，包含 `topic` 字段。
   */
  async publish(event: EnvironmentEventEnvelope) {
    this.emitLocal(event);
    if (!this.client?.connected) return;
    this.client.publish(event.topic, JSON.stringify(event));
  }

  /**
   * 解析 MQTT 环境事件并补齐观测时间、保留标记、来源与主题；缺少必要身份或 JSON 非法时忽略消息。
   * @param topic - 决定MQTT消息内容、边界或目标的 `topic` 值。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `toString` 字段。
   * @param packet - 用于MQTT消息的领域对象，包含 `retain` 字段；省略时默认采用 `{}`。
   */
  private handleMqttMessage(
    topic: string,
    payload: Buffer,
    packet: { retain?: boolean } = {},
  ) {
    try {
      const parsed = JSON.parse(
        payload.toString('utf8'),
      ) as Partial<EnvironmentEventEnvelope>;
      if (!parsed.eventId || !parsed.siteId || !parsed.severity) return;
      this.emitLocal({
        ...parsed,
        observedAt: parsed.observedAt || new Date().toISOString(),
        retained: parsed.retained ?? !!packet.retain,
        sourceKind: parsed.sourceKind || 'mqtt',
        summary: parsed.summary || 'MQTT environment event',
        topic: parsed.topic || topic,
      } as EnvironmentEventEnvelope);
    } catch (err) {
      this.logger.warn(
        `Environment MQTT payload ignored: ${
          (() => {
            if (err instanceof Error) {
              return err.message;
            }
            return 'invalid json';
          })()
        }`,
      );
    }
  }

  /**
   * 根据当前运行态处理MQTT关闭。
   */
  private handleMqttClose() {
    this.emitLocal(this.createBrokerStatusEvent('MQTT broker disconnected'));
  }

  /**
   * 将 MQTT 客户端错误转换为本地代理状态事件并通知环境事件订阅者。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   */
  private handleMqttError(err: Error) {
    this.emitLocal(
      this.createBrokerStatusEvent(`MQTT broker error: ${err.message}`),
    );
  }

  /**
   * 按注册顺序把环境事件同步投递给当前全部本地订阅者。
   * @param event - 触发本地的领域事件。
   */
  private emitLocal(event: EnvironmentEventEnvelope) {
    this.subscribers.forEach((subscriber) => subscriber(event));
  }

  /**
   * 根据`summary`构造消息代理状态事件。
   * @param summary - 决定消息代理状态事件内容、边界或目标的 `summary` 值。
   * @returns 包含 `eventId`、`observedAt`、`severity`、`siteId`、`sourceKind` 字段的消息代理状态事件。
   */
  private createBrokerStatusEvent(summary: string): EnvironmentEventEnvelope {
    return {
      eventId: `env-bus-${Date.now()}`,
      observedAt: new Date().toISOString(),
      severity: 'unknown',
      siteId: 'local-dev',
      sourceKind: 'local',
      summary,
      topic: `${this.options.topicPrefix}/event/local-dev/environment-event-bus/status`,
    };
  }
}
