import * as fs from 'fs';
import { fuzzySearchPath } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';
import { logger } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-logger';
import type { FuzzySearchConfig } from '@/modules/qqbot/plugins/bangDream/search/fuzzy-search.types';

export class SearchDictionaryRepository {
  constructor(private readonly filePath = fuzzySearchPath) {}

  /**
   * 读取搜索别名配置。
   */
  loadConfig(): FuzzySearchConfig {
    const fileContent = fs.readFileSync(this.filePath, 'utf-8');
    logger('fuzzySearch', 'loaded fuzzy search config');
    return JSON.parse(fileContent);
  }
}

export const searchDictionaryRepository = new SearchDictionaryRepository();
