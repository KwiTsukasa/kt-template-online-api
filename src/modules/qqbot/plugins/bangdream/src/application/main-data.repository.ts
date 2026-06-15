import mainAPI from '@/modules/qqbot/plugins/bangdream/src/application/main-data-store';
import type { BANGDREAM_BESTDORI_API_PATHS } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

export type BangDreamMainDataKey = keyof typeof BANGDREAM_BESTDORI_API_PATHS;
export type BangDreamMainDataCollection<T = unknown> = Record<string, T>;

export class BangDreamMainDataRepository {
  constructor(
    private readonly store: Record<string, unknown> = mainAPI as Record<
      string,
      unknown
    >,
  ) {}

  /**
   * 获取 Bestdori 主数据集合。
   *
   * @param key - 主数据集合编码。
   */
  getCollection<T = unknown>(
    key: BangDreamMainDataKey,
  ): BangDreamMainDataCollection<T> {
    return (this.store[key] ?? {}) as BangDreamMainDataCollection<T>;
  }

  /**
   * 获取原始主数据值，适用于 rates 这类非对象映射集合。
   *
   * @param key - 主数据集合编码。
   */
  getValue<T = unknown>(key: BangDreamMainDataKey): T {
    return (this.store[key] ?? {}) as T;
  }

  /**
   * 按 ID 获取 Bestdori 主数据实体。
   *
   * @param key - 主数据集合编码。
   * @param id - 实体 ID。
   */
  getEntity<T = unknown>(
    key: BangDreamMainDataKey,
    id: number | string,
  ): T | undefined {
    return this.getCollection<T>(key)[String(id)];
  }

  /**
   * 获取集合中可转成数字的实体 ID。
   *
   * @param key - 主数据集合编码。
   */
  getNumericIds(key: BangDreamMainDataKey): number[] {
    return Object.keys(this.getCollection(key))
      .map(Number)
      .filter((id) => Number.isFinite(id));
  }
}

export const bangDreamMainDataRepository = new BangDreamMainDataRepository();
