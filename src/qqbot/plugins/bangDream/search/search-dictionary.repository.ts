import * as fs from 'fs';
import { fuzzySearchPath } from '@/qqbot/plugins/bangDream/config/runtime-config';
import { logger } from '@/qqbot/plugins/bangDream/shared/bangdream-logger';
import type { FuzzySearchConfig } from '@/qqbot/plugins/bangDream/search/fuzzy-search.types';

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
