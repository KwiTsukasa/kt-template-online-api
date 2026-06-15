import { fuzzySearchPath } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import type { FuzzySearchConfig } from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search.types';
import { readBangDreamJsonFileSync } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

export class SearchDictionaryRepository {
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
