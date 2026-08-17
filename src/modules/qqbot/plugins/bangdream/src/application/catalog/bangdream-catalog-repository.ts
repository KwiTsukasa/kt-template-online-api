import bangdreamCatalogCache from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import type { BANGDREAM_BESTDORI_API_PATHS } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

export type BangDreamCatalogKey = keyof typeof BANGDREAM_BESTDORI_API_PATHS;
export type BangDreamCatalogCollection<T = unknown> = Record<string, T>;

export class BangDreamCatalogRepository {
  constructor(
    private readonly catalog: Record<
      string,
      unknown
    > = bangdreamCatalogCache as Record<string, unknown>,
  ) {}

  /**
   * 按目录键读取 Bestdori 对象集合，并在该目录缺失时返回空对象。
   * @param key - 用于读取或更新Bestdori 目录集合的稳定键。
   * @returns 规范化后的Bestdori 目录集合；主值为空时采用 `{}` 兜底。
   */
  getCollection<T = unknown>(
    key: BangDreamCatalogKey,
  ): BangDreamCatalogCollection<T> {
    return (this.catalog[key] ?? {}) as BangDreamCatalogCollection<T>;
  }

  /**
   * 获取原始目录值，适用于 rates 这类非对象映射集合。
   * @param key - 用于读取或更新原始目录值，适用于 rates 这类非对象映射集合的稳定键。
   * @returns 规范化后的原始目录值，适用于 rates 这类非对象映射集合；主值为空时采用 `{}` 兜底。
   */
  getValue<T = unknown>(key: BangDreamCatalogKey): T {
    return (this.catalog[key] ?? {}) as T;
  }

  /**
   * 按目录键与实体 ID 读取 Bestdori 记录；目录或实体不存在时返回 `undefined`。
   * @param key - 用于读取或更新按目录键与实体 ID 读取 Bestdori 记录的稳定键。
   * @param id - 决定按目录键与实体 ID 读取 Bestdori 记录内容、边界或目标的 `id` 值。
   * @returns 按目录键与实体 ID 读取 Bestdori 记录。
   */
  getEntity<T = unknown>(
    key: BangDreamCatalogKey,
    id: number | string,
  ): T | undefined {
    return this.getCollection<T>(key)[String(id)];
  }

  /**
   * 根据参数 `key`，获取集合中可转成数字的实体 ID。
   * @param key - 用于读取或更新根据参数 `key`，获取集合中可转成数字的实体 ID的稳定键。
   * @returns 按输入顺序得到的根据参数 `key`，获取集合中可转成数字的实体 ID列表；没有匹配项时为空数组。
   */
  getNumericIds(key: BangDreamCatalogKey): number[] {
    return Object.keys(this.getCollection(key))
      .map(Number)
      .filter((id) => Number.isFinite(id));
  }
}

export const bangdreamCatalogRepository = new BangDreamCatalogRepository();
