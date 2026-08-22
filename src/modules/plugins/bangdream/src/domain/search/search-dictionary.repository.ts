import { fuzzySearchPath } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { logger } from '@/modules/plugins/bangdream/src/application/bangdream-logger';
import type { FuzzySearchConfig } from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search.types';
import { readBangDreamJsonFileSync } from '@/modules/plugins/bangdream/src/infrastructure/integration/runtime-io';

export class SearchDictionaryRepository {
  constructor(private readonly filePath = fuzzySearchPath) {}

  /**
   * 从 BangDream 搜索字典 JSON 文件读取别名配置。
   * @returns 从 BangDream 搜索字典 JSON 文件读取别名配置。
   */
  loadConfig(): FuzzySearchConfig {
    const config = readBangDreamJsonFileSync<FuzzySearchConfig>(this.filePath);
    logger('fuzzySearch', 'loaded fuzzy search config');
    return config;
  }
}

export const searchDictionaryRepository = new SearchDictionaryRepository();
