import { fuzzySearchPath } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import type { FuzzySearchConfig } from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search.types';
import { readBangDreamJsonFileSync } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

export class SearchDictionaryRepository {
  /**
   * 初始化 SearchDictionaryRepository 实例。
   * @param filePath - BangDream路径；影响 constructor 的返回值。
   */
  constructor(private readonly filePath = fuzzySearchPath) {}

  /**
   * 读取搜索别名配置。
   */
  loadConfig(): FuzzySearchConfig {
    const config = readBangDreamJsonFileSync<FuzzySearchConfig>(this.filePath);
    logger('fuzzySearch', 'loaded fuzzy search config');
    return config;
  }
}

export const searchDictionaryRepository = new SearchDictionaryRepository();
