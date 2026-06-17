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

  /**
   * 初始化 QqbotBusService 实例。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * 处理 QQBot 核心事件。
   */
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

  /**
   * 处理 QQBot 核心事件。
   */
  async onModuleDestroy() {
    if (!this.client) return;
    await new Promise<void>((resolve) => {
      this.client?.end(false, {}, () => resolve());
    });
  }

  /**
   * 投递 QQBot 核心消息或任务。
   * @param topic - topic 输入；驱动 `emitter.emit()`、`client.publish()` 的 QQBot步骤。
   * @param payload - payload 输入；驱动 `emitter.emit()`、`client.publish()` 的 QQBot步骤。
   */
  async publish(topic: string, payload: any) {
    this.emitter.emit(topic, payload);

    if (!this.client?.connected) return;
    this.client.publish(topic, JSON.stringify(payload));
  }

  /**
   * 执行 QQBot 核心流程。
   * @param topic - topic 输入；驱动 `emitter.on()` 的 QQBot步骤。
   * @param handler - handler 输入；驱动 `emitter.on()` 的 QQBot步骤。
   */
  subscribe(topic: string, handler: QqbotBusHandler) {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }

  /**
   * 查询 QQBot 核心数据。
   */
  getStatus() {
    return {
      connected: !!this.client?.connected,
      mode: this.getEventBusMode(),
      url: this.maskUrl(this.configService.get<string>('MQTT_URL') || ''),
    };
  }

  /**
   * 查询 QQBot 核心数据。
   */
  private getEventBusMode() {
    return this.configService.get<string>('QQBOT_EVENT_BUS') || 'local';
  }

  /**
   * 执行 QQBot 核心流程。
   * @param url - 访问地址；生成规范化文本。
   */
  private maskUrl(url: string) {
    if (!url) return '';
    return url.replace(/:\/\/([^:@]+):([^@]+)@/, '://***:***@');
  }
}
