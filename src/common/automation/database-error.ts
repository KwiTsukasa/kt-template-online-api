import { MYSQL_DUPLICATE_ENTRY } from './constants/persistence';

/**
 * 只识别数据库明确报告的唯一约束冲突，不把连接中断或提交失败当成幂等重放。
 * @param error - 驱动原始错误或 TypeORM 包装错误。
 * @param indexName - 需要匹配的唯一索引；省略时接受任意唯一索引冲突。
 * @returns 错误码及可选索引均匹配时返回真。
 */
export function isAutomationUniqueConflict(
  error: unknown,
  indexName?: string,
): boolean {
  if (!error || typeof error !== 'object') return false;
  let driver = error as {
    code?: string;
    message?: string;
    driverError?: unknown;
  };
  if (driver.driverError && typeof driver.driverError === 'object')
    driver = driver.driverError as typeof driver;
  if (driver.code !== MYSQL_DUPLICATE_ENTRY) return false;
  if (!indexName) return true;
  const key = /for key ['`](?:[^'`]+\.)?([^'`]+)['`]/.exec(
    driver.message ?? '',
  )?.[1];
  return key === indexName;
}
