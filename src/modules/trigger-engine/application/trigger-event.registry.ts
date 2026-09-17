import { requireExecutionState } from '@/common/automation/validation';
import { Injectable } from '@nestjs/common';
import { normalizeDataSchema } from '@/common/automation/data-schema';
import type {
  TriggerEventRegistryPort,
  TriggerEventSource,
} from '../contract/trigger-runtime.port';

@Injectable()
export class TriggerEventRegistry implements TriggerEventRegistryPort {
  private readonly sources = new Map<string, TriggerEventSource>();

  /**
   * 接收业务装配层审核过的事件数据契约，不注册任何任务执行函数。
   * @param source - 事件身份、固定版本与允许公开的载荷字段。
   * @returns 只撤销本次事件源注册的释放函数。
   * @throws 事件身份、字段契约非法或同版本重复时拒绝注册。
   */
  register(source: TriggerEventSource): () => void {
    requireExecutionState(
      /^[a-z][a-z0-9_.-]{2,127}$/.test(source.key) &&
        Number.isSafeInteger(source.version) &&
        !(source.version < 1),
      '事件源身份不合法',
    );
    requireExecutionState(
      typeof source.name === 'string' &&
        source.name.trim() &&
        !(source.name.length > 128),
      '事件源名称不合法',
    );
    const key = `${source.key}@${source.version}`;
    requireExecutionState(!this.sources.has(key), '事件源版本重复注册');
    const saved = {
      ...source,
      payloadSchema: normalizeDataSchema(source.payloadSchema),
    };
    this.sources.set(key, saved);
    return () => {
      if (this.sources.get(key) === saved) this.sources.delete(key);
    };
  }

  /**
   * 解析当前加载的固定事件契约，事件源卸载后不自动替换版本。
   * @param key - 事件源业务标识。
   * @param version - 明确选择的契约版本。
   * @returns 与注册状态分离的事件契约；未加载时为空。
   */
  resolve(key: string, version: number): TriggerEventSource | undefined {
    const source = this.sources.get(`${key}@${version}`);
    if (source) return structuredClone(source);
    return undefined;
  }

  /**
   * 提供可选择的业务事件及字段目录，不暴露业务模块的内部状态。
   * @returns 与内部注册对象分离的事件源目录。
   */
  catalog(): TriggerEventSource[] {
    return structuredClone([...this.sources.values()]);
  }
}
