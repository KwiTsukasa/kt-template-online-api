import {
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
} from './system-message-runner.constants';
import type { SystemMessageScalar } from '../contract/message-management.types';
import { MessageSubscriberRegistry } from './subscriber/message-subscriber.registry';
import { SystemMessageFanoutService } from './system-message-fanout.service';

@Injectable()
export class SystemMessageDeliveryCoordinatorService
  implements OnModuleDestroy
{
  private readonly logger = new Logger(
    SystemMessageDeliveryCoordinatorService.name,
  );
  private destroyed = false;
  private drainRequested = false;
  private drainPromise: null | Promise<void> = null;
  private drainOutcome?: { error?: unknown };

  constructor(
    private readonly fanoutRunner: SystemMessageFanoutService,
    private readonly subscriberRegistry: MessageSubscriberRegistry,
  ) {}

  /**
   * 等待既有发件箱和订阅者完成本轮排空，失败原样交给调用方记录。
   * @throws 任一投递阶段失败时拒绝本轮调用。
   */
  async drain(): Promise<void> {
    if (this.destroyed) throw new Error('消息投递服务已经关闭');
    this.requestDrain();
    const outcome = this.drainOutcome;
    await this.drainPromise;
    if (outcome?.error) throw outcome.error;
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.drainRequested = false;
    await this.drainPromise;
  }

  /**
   * 按当前运行态投递排空。
   */
  requestDrain(): void {
    if (this.destroyed) return;
    this.drainRequested = true;
    if (this.drainPromise) return;
    const outcome: { error?: unknown } = {};
    this.drainOutcome = outcome;
    this.drainPromise = this.drainLoop()
      .catch((error: unknown) => {
        outcome.error = error;
        this.logger.warn(
          'System message drain failed',
          (() => {
            if (error instanceof Error) {
              return error.message;
            }
            return undefined;
          })(),
        );
      })
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
      if (this.drainOutcome) this.drainOutcome.error = error;
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
