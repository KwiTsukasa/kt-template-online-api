import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';

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
     * @param num - num 输入；影响 test 的返回值。
     * @param match - match 输入；驱动 `parseFloat()` 的 BangDream步骤。
     */
    test: (num, match) => num < parseFloat(match[1]),
  },
  {
    pattern: /^>(\d+)$/,
    /**
     * 判断数字是否大于关系表达式右值。
     *
     * @param num - num 输入；影响 test 的返回值。
     * @param match - match 输入；驱动 `parseFloat()` 的 BangDream步骤。
     */
    test: (num, match) => num > parseFloat(match[1]),
  },
  {
    pattern: /^(\d+)-(\d+)$/,
    /**
     * 判断数字是否落入关系表达式闭区间。
     *
     * @param num - num 输入；驱动 `parseFloat()` 的 BangDream步骤。
     * @param match - match 输入；驱动 `parseFloat()` 的 BangDream步骤。
     */
    test: (num, match) =>
      num >= parseFloat(match[1]) && num <= parseFloat(match[2]),
  },
];

/**
 * 统一关系表达式中的符号写法。
 *
 * @param keyword - keyword 输入；影响 normalizeRelationKeyword 的返回值。
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
 * @param relationStr - relationStr 输入；驱动 `RELATION_PATTERNS.some()` 的 BangDream步骤。
 */
export function isValidRelationStr(relationStr: string): boolean {
  return RELATION_PATTERNS.some((pattern) => pattern.test(relationStr));
}

/**
 * 创建数值关系表达式匹配器。
 *
 * @param relationStr - relationStr 输入；提取正则匹配结果。
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
 * @param num - num 输入；影响 checkRelationList 的返回值。
 * @param relationStrList - relationStrList 输入；驱动 `for()` 的 BangDream步骤。
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
