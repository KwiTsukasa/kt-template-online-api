import bangdreamCatalogCache from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import type { BANGDREAM_BESTDORI_API_PATHS } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

export type BangDreamCatalogKey = keyof typeof BANGDREAM_BESTDORI_API_PATHS;
export type BangDreamCatalogCollection<T = unknown> = Record<string, T>;

export class BangDreamCatalogRepository {
  /**
   * 初始化 BangDreamCatalogRepository 实例。
   * @param catalog - catalog 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly catalog: Record<
      string,
      unknown
    > = bangdreamCatalogCache as Record<string, unknown>,
  ) {}

  /**
   * 获取 Bestdori 目录集合。
   *
   * @param key - 键名；限定 BangDream查询范围。
   */
  getCollection<T = unknown>(
    key: BangDreamCatalogKey,
  ): BangDreamCatalogCollection<T> {
    return (this.catalog[key] ?? {}) as BangDreamCatalogCollection<T>;
  }

  /**
   * 获取原始目录值，适用于 rates 这类非对象映射集合。
   *
   * @param key - 键名；限定 BangDream查询范围。
   */
  getValue<T = unknown>(key: BangDreamCatalogKey): T {
    return (this.catalog[key] ?? {}) as T;
  }

  /**
   * 按 ID 获取 Bestdori 目录实体。
   *
   * @param key - 键名；限定 BangDream查询范围。
   * @param id - BangDream记录 ID；定位本次读取、更新、删除或关联的BangDream记录。
   */
  getEntity<T = unknown>(
    key: BangDreamCatalogKey,
    id: number | string,
  ): T | undefined {
    return this.getCollection<T>(key)[String(id)];
  }

  /**
   * 获取集合中可转成数字的实体 ID。
   *
   * @param key - 键名；驱动 `Object.keys()` 的 BangDream步骤。
   */
  getNumericIds(key: BangDreamCatalogKey): number[] {
    return Object.keys(this.getCollection(key))
      .map(Number)
      .filter((id) => Number.isFinite(id));
  }
}

export const bangdreamCatalogRepository = new BangDreamCatalogRepository();
