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
import type { BotBusHandler } from '../../../contract/bot.types';

@Injectable()
export class BotBusService implements OnModuleInit, OnModuleDestroy {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(BotBusService.name);
  private client: MqttClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    if (this.getEventBusMode() !== 'mqtt') return;

    const url = this.configService.get<string>('MQTT_URL');
    if (!url) {
      this.logger.warn('Bot MQTT_URL 未配置，事件总线降级为本地内存模式');
      return;
    }

    this.client = mqtt.connect(url, {
      clientId:
        this.configService.get<string>('MQTT_CLIENT_ID') ||
        'kt-template-online-api-bot',
      password: this.configService.get<string>('MQTT_PASSWORD') || undefined,
      username: this.configService.get<string>('MQTT_USERNAME') || undefined,
    });

    this.client.on('connect', () => {
      this.logger.log(`Bot MQTT 已连接: ${url}`);
    });
    this.client.on('error', (err) => {
      this.logger.warn(`Bot MQTT 连接异常: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (!this.client) return;
    await new Promise<void>((resolve) => {
      this.client?.end(false, {}, () => resolve());
    });
  }

  /**
   * 按`topic`、`payload`投递`publish` 对应结果；向目标通道投递结果（`emitter.emit`）。
   * @param topic - 决定`publish` 对应结果内容、边界或目标的 `topic` 值。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   */
  async publish(topic: string, payload: any) {
    this.emitter.emit(topic, payload);

    if (!this.client?.connected) return;
    this.client.publish(topic, JSON.stringify(payload));
  }

  /**
   * 通过 `emitter.on` 注册或发布事件。
   * @param topic - 决定subscribe内容、边界或目标的 `topic` 值。
   * @param handler - 决定subscribe内容、边界或目标的 `handler` 值。
   * @returns 移除本次主题监听器的退订函数；调用后该处理器不再接收后续事件。
   */
  subscribe(topic: string, handler: BotBusHandler) {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }

  /**
   * 按当前运行态读取状态；从 `getEventBusMode` 读取状态。
   * @returns 包含 `connected`、`mode`、`url` 字段的状态。
   */
  getStatus() {
    return {
      connected: !!this.client?.connected,
      mode: this.getEventBusMode(),
      url: this.maskUrl(this.configService.get<string>('MQTT_URL') || ''),
    };
  }

  /**
   * 按当前运行态读取事件BusMode；从 `configService.get` 读取事件BusMode。
   * @returns 规范化后的事件BusMode；主值为空时采用 `'local'` 兜底。
   */
  private getEventBusMode() {
    return this.configService.get<string>('BOT_EVENT_BUS') || 'local';
  }

  /**
   * 将`url`中的URL 地址认证信息替换为掩码；无法解析时保留原值。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @returns 认证信息已替换为掩码的URL 地址；输入为空时为 `undefined`，解析失败时保留原文本。
   */
  private maskUrl(url: string) {
    if (!url) return '';
    return url.replace(/:\/\/([^:@]+):([^@]+)@/, '://***:***@');
  }
}
