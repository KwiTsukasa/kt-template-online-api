import { EventEmitter } from 'events';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { QqbotBusHandler } from '../../../contract/qqbot.types';

@Injectable()
export class QqbotBusService implements OnModuleInit, OnModuleDestroy {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(QqbotBusService.name);
  private client: MqttClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    if (this.getEventBusMode() !== 'mqtt') return;

    const url = this.configService.get<string>('MQTT_URL');
    if (!url) {
      this.logger.warn('QQBot MQTT_URL 未配置，事件总线降级为本地内存模式');
      return;
    }

    this.client = mqtt.connect(url, {
      clientId:
        this.configService.get<string>('MQTT_CLIENT_ID') ||
        'kt-template-online-api-qqbot',
      password: this.configService.get<string>('MQTT_PASSWORD') || undefined,
      username: this.configService.get<string>('MQTT_USERNAME') || undefined,
    });

    this.client.on('connect', () => {
      this.logger.log(`QQBot MQTT 已连接: ${url}`);
    });
    this.client.on('error', (err) => {
      this.logger.warn(`QQBot MQTT 连接异常: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (!this.client) return;
    await new Promise<void>((resolve) => {
      this.client?.end(false, {}, () => resolve());
    });
  }

  async publish(topic: string, payload: any) {
    this.emitter.emit(topic, payload);

    if (!this.client?.connected) return;
    this.client.publish(topic, JSON.stringify(payload));
  }

  subscribe(topic: string, handler: QqbotBusHandler) {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }

  getStatus() {
    return {
      connected: !!this.client?.connected,
      mode: this.getEventBusMode(),
      url: this.maskUrl(this.configService.get<string>('MQTT_URL') || ''),
    };
  }

  private getEventBusMode() {
    return this.configService.get<string>('QQBOT_EVENT_BUS') || 'local';
  }

  private maskUrl(url: string) {
    if (!url) return '';
    return url.replace(/:\/\/([^:@]+):([^@]+)@/, '://***:***@');
  }
}
