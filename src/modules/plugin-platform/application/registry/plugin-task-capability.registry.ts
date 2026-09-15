import { Injectable, Logger } from '@nestjs/common';
import type {
  PluginTaskCapabilities,
  PluginTaskCapabilityPort,
} from '../../contract/plugin-task-capability.port';

@Injectable()
export class PluginTaskCapabilityRegistry implements PluginTaskCapabilityPort {
  private readonly logger = new Logger(PluginTaskCapabilityRegistry.name);
  private readonly snapshots = new Map<string, PluginTaskCapabilities>();
  private readonly listeners = new Set<
    (snapshot: PluginTaskCapabilities) => void
  >();

  /**
   * 返回插件自身声明的能力快照，外部集成不能修改平台缓存。
   * @returns 安装身份、版本和运行可用性对应的任务声明副本。
   */
  list(): PluginTaskCapabilities[] {
    return [...this.snapshots.values()].map((snapshot) =>
      structuredClone(snapshot),
    );
  }

  /**
   * 订阅能力变化并由集成层自行处理调度、持久化与失败恢复。
   * @param listener - 仅接收声明副本的同步通知回调。
   * @returns 只移除本次订阅的释放函数。
   */
  subscribe(listener: (snapshot: PluginTaskCapabilities) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 保存插件能力并通知订阅方；外部通知失败不使插件启用或安装失败。
   * @param snapshot - 已验证清单和插件实际运行身份。
   */
  publish(snapshot: PluginTaskCapabilities): void {
    this.snapshots.set(snapshot.installationId, structuredClone(snapshot));
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(snapshot));
      } catch {
        this.logger.warn('插件任务能力订阅方处理失败，集成层可重新读取快照');
      }
    }
  }

  /**
   * 撤销运行可用性并保留任务清单，具体触发入口由外部集成关闭。
   * @param installationId - 已停用或卸载的插件安装身份。
   */
  suspend(installationId: string): void {
    const snapshot = this.snapshots.get(installationId);
    if (snapshot) this.publish({ ...snapshot, active: false });
  }
}
