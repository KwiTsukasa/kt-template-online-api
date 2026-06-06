import { logger } from '@/qqbot/plugins/bangDream/tsugu/runtime/logger';

const RELATION_PATTERNS = [/^<\d+$/, /^>\d+$/, /^\d+-\d+$/];

interface RelationChecker {
  pattern: RegExp;
  test: (num: number, match: RegExpMatchArray) => boolean;
}

const RELATION_CHECKERS: RelationChecker[] = [
  {
    pattern: /^<(\d+)$/,
    /**
     * 判断数字是否小于关系表达式右值。
     *
     * @param num - 待匹配数字。
     * @param match - 关系表达式捕获结果。
     */
    test: (num, match) => num < parseFloat(match[1]),
  },
  {
    pattern: /^>(\d+)$/,
    /**
     * 判断数字是否大于关系表达式右值。
     *
     * @param num - 待匹配数字。
     * @param match - 关系表达式捕获结果。
     */
    test: (num, match) => num > parseFloat(match[1]),
  },
  {
    pattern: /^(\d+)-(\d+)$/,
    /**
     * 判断数字是否落入关系表达式闭区间。
     *
     * @param num - 待匹配数字。
     * @param match - 关系表达式捕获结果。
     */
    test: (num, match) =>
      num >= parseFloat(match[1]) && num <= parseFloat(match[2]),
  },
];

/**
 * 统一关系表达式中的符号写法。
 *
 * @param keyword - 用户输入的搜索关键词。
 */
export function normalizeRelationKeyword(keyword: string): string {
  return keyword
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/＞/g, '>')
    .replace(/＜/g, '<');
}

/**
 * 判断关系表达式是否可用于范围匹配。
 *
 * @param relationStr - 关系表达式。
 */
export function isValidRelationStr(relationStr: string): boolean {
  return RELATION_PATTERNS.some((pattern) => pattern.test(relationStr));
}

/**
 * 创建数值关系表达式匹配器。
 *
 * @param relationStr - 关系表达式。
 */
function createRelationMatcher(relationStr: string): (num: number) => boolean {
  for (const checker of RELATION_CHECKERS) {
    const relationMatch = relationStr.match(checker.pattern);
    if (relationMatch) {
      return (num) => checker.test(num, relationMatch);
    }
  }
  throw new Error('Invalid relation string format');
}

/**
 * 检查数值列表是否满足关系表达式。
 *
 * @param num - 待匹配数字。
 * @param relationStrList - 关系表达式列表。
 */
export function checkRelationList(
  num: number,
  relationStrList: string[],
): boolean {
  for (const relationStr of relationStrList) {
    try {
      if (createRelationMatcher(relationStr)(num)) {
        return true;
      }
    } catch {
      logger('fuzzySearch', 'Invalid relation string format');
    }
  }
  return false;
}
