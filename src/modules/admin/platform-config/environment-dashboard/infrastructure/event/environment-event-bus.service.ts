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

  subscribe(subscriber: EnvironmentEventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async publish(event: EnvironmentEventEnvelope) {
    this.emitLocal(event);
    if (!this.client?.connected) return;
    this.client.publish(event.topic, JSON.stringify(event));
  }

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
          err instanceof Error ? err.message : 'invalid json'
        }`,
      );
    }
  }

  private handleMqttClose() {
    this.emitLocal(this.createBrokerStatusEvent('MQTT broker disconnected'));
  }

  private handleMqttError(err: Error) {
    this.emitLocal(
      this.createBrokerStatusEvent(`MQTT broker error: ${err.message}`),
    );
  }

  private emitLocal(event: EnvironmentEventEnvelope) {
    this.subscribers.forEach((subscriber) => subscriber(event));
  }

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
