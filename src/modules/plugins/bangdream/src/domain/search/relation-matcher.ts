import { logger } from '@/modules/plugins/bangdream/src/application/bangdream-logger';

const RELATION_PATTERNS = [/^<\d+$/, /^>\d+$/, /^\d+-\d+$/];

interface RelationChecker {
  pattern: RegExp;
  test: (num: number, match: RegExpMatchArray) => boolean;
}

const RELATION_CHECKERS: RelationChecker[] = [
  {
    pattern: /^<(\d+)$/,
    test: (num, match) => num < parseFloat(match[1]),
  },
  {
    pattern: /^>(\d+)$/,
    test: (num, match) => num > parseFloat(match[1]),
  },
  {
    pattern: /^(\d+)-(\d+)$/,
    test: (num, match) =>
      num >= parseFloat(match[1]) && num <= parseFloat(match[2]),
  },
];

/**
 * 按规范统一关系表达式中的符号写法。
 * @param keyword - 决定按规范统一关系表达式中的符号写法内容、边界或目标的 `keyword` 值。
 * @returns 按规范统一关系表达式中的符号写法。
 */
export function normalizeRelationKeyword(keyword: string): string {
  return keyword
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/＞/g, '>')
    .replace(/＜/g, '<');
}

/**
 * 根据`relationStr`与当前约束判定关系表达式是否可用于范围匹配。
 * @param relationStr - 决定关系表达式是否可用于范围匹配内容、边界或目标的 `relationStr` 值。
 * @returns 满足关系表达式是否可用于范围匹配约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isValidRelationStr(relationStr: string): boolean {
  return RELATION_PATTERNS.some((pattern) => pattern.test(relationStr));
}

/**
 * 根据参数 `relationStr`，创建数值关系表达式匹配器。
 * @param relationStr - 用于根据参数 `relationStr`，创建数值关系表达式匹配器的领域对象，包含 `match` 字段。
 * @returns 根据参数 `relationStr`，创建数值关系表达式匹配器。
 * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `Error`。
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
 * 根据数值关系表达式判断列表中是否存在任一匹配项。
 * @param num - 决定根据数值关系表达式判断列表中是否存在任一匹配项内容、边界或目标的 `num` 值。
 * @param relationStrList - 决定根据数值关系表达式判断列表中是否存在任一匹配项内容、边界或目标的 `relationStrList` 值。
 * @returns 满足根据数值关系表达式判断列表中是否存在任一匹配项约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
