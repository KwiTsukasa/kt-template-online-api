import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_SCAN_INTERVAL_MS,
} from './system-message-runner.constants';
import type { SystemMessageScalar } from '../contract/message-management.types';
import { MessageSubscriberRegistry } from './subscriber/message-subscriber.registry';
import { SystemMessageFanoutService } from './system-message-fanout.service';

@Injectable()
export class SystemMessageDeliveryCoordinatorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    SystemMessageDeliveryCoordinatorService.name,
  );
  private destroyed = false;
  private drainRequested = false;
  private drainPromise: null | Promise<void> = null;
  private scanInterval?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;

  constructor(
    private readonly fanoutRunner: SystemMessageFanoutService,
    private readonly subscriberRegistry: MessageSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    if (this.destroyed || this.scanInterval) return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      this.requestDrain();
    }, 0);
    this.startupTimer.unref?.();
    this.scanInterval = setInterval(
      () => this.requestDrain(),
      SYSTEM_MESSAGE_SCAN_INTERVAL_MS,
    );
    this.scanInterval.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.drainRequested = false;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.startupTimer = undefined;
    this.scanInterval = undefined;
    await this.drainPromise;
  }

  /**
   * 按当前运行态投递排空。
   */
  requestDrain(): void {
    if (this.destroyed) return;
    this.drainRequested = true;
    if (this.drainPromise) return;
    this.drainPromise = this.drainLoop()
      .catch((error: unknown) =>
        this.logger.warn(
          'System message drain failed',
          (() => {
            if (error instanceof Error) {
              return error.message;
            }
            return undefined;
          })(),
        ),
      )
      .finally(() => {
        this.drainPromise = null;
        if (!this.destroyed && this.drainRequested) this.requestDrain();
      });
  }

  /**
   * 接收消息源依赖变化并仅唤醒消息管理的延迟事件，订阅者不会看到来源依赖语义。
   * @param input - 外部消息源依赖的稳定键及经过协议约束的标量载荷。
   */
  async notifyDependencyChanged(input: {
    dependencyKey: string;
    payload: Record<string, SystemMessageScalar>;
  }): Promise<void> {
    if (this.destroyed || !input.dependencyKey.trim()) return;
    const advanced = await this.fanoutRunner.wakeDeferred(new Date());
    if (advanced > 0) this.requestDrain();
  }

  /**
   * 根据当前运行态处理对应领域流程并产生排空循环。
   */
  private async drainLoop(): Promise<void> {
    while (!this.destroyed && this.drainRequested) {
      this.drainRequested = false;
      const fanout = await this.runBounded('fan-out', () =>
        this.fanoutRunner.runOnce(),
      );
      let subscriberLimitReached = false;
      for (const subscriber of this.subscriberRegistry.list()) {
        const delivery = await this.runBounded(
          `delivery:${subscriber.definition.subscriberKey}`,
          () => subscriber.runOnce(new Date()),
        );
        if (delivery === SYSTEM_MESSAGE_BATCH_SIZE) {
          subscriberLimitReached = true;
        }
      }
      if (fanout === SYSTEM_MESSAGE_BATCH_SIZE || subscriberLimitReached) {
        this.drainRequested = true;
      }
    }
  }

  /**
   * 在单轮上限内重复领取并执行投递，直到队列暂空或达到最大处理数量。
   * @param name - 决定在单轮上限内重复领取并执行投递，直到队列暂空或达到最大处理数量内容、边界或目标的 `name` 值。
   * @param runner - 负责完成在单轮上限内重复领取并执行投递，直到队列暂空或达到最大处理数量外部交互的受控能力。
   * @returns 返回本轮实际领取并处理的投递数量，队列为空时可为 `0`。
   */
  private async runBounded(
    name: string,
    runner: () => Promise<number>,
  ): Promise<number> {
    try {
      return await runner();
    } catch (error) {
      this.logger.warn(
        `System message ${name} scan failed`,
        (() => {
          if (error instanceof Error) {
            return error.message;
          }
          return undefined;
        })(),
      );
      return 0;
    }
  }
}
