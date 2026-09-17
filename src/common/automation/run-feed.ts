import { requireRequest } from '@/common/automation/validation';

export type RunKind = 'task' | 'workflow' | 'schedule';
export type RunPhase =
  | 'pending'
  | 'active'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped';
export type RunFeedQuery = {
  beforeId?: string;
  limit: number;
  phase?: RunPhase;
};
export type RunSummary = {
  kind: RunKind;
  runId: string;
  resourceId: string;
  resourceVersion: number;
  name: string;
  phase: RunPhase;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  requiresReview: boolean;
  hasError: boolean;
};
export interface RunFeedPort {
  page: (query: RunFeedQuery) => Promise<RunSummary[]>;
}

/**
 * 限制运行摘要查询为有界游标，避免大整数身份被数字转换截断。
 * @param input - 来自查询字符串或内部调用的分页条件。
 * @returns 已验证的分页大小、运行阶段和原样字符串游标。
 * @throws 游标、页大小或运行阶段非法时返回 HTTP 400。
 */
export function normalizeRunFeedQuery(
  input: Record<string, unknown>,
): RunFeedQuery {
  const limit = Number(input.limit ?? 30);
  requireRequest(
    Number.isInteger(limit) && limit >= 1 && limit <= 100,
    '每页记录数必须为 1 至 100',
  );
  const result: RunFeedQuery = { limit };
  if (input.beforeId !== undefined) {
    requireRequest(
      typeof input.beforeId === 'string' &&
        /^[1-9]\d{0,18}$/.test(input.beforeId) &&
        BigInt(input.beforeId) <= 9223372036854775807n,
      '运行游标无效',
    );
    result.beforeId = input.beforeId;
  }
  if (input.phase !== undefined) {
    requireRequest(typeof input.phase === 'string', '运行阶段无效');
    requireRequest(
      [
        'pending',
        'active',
        'succeeded',
        'failed',
        'cancelled',
        'skipped',
      ].includes(String(input.phase)),
      '运行阶段无效',
    );
    result.phase = input.phase as RunPhase;
  }
  return result;
}

/**
 * 将等待、启动及运行中的领域状态归为活动阶段，保留终态原意。
 * @param status - 所属执行模块保存的运行状态。
 * @returns 仅供跨模块筛选和显示的运行阶段。
 */
export function projectRunPhase(status: string): RunPhase {
  if (['starting', 'running', 'waiting'].includes(status)) return 'active';
  return status as RunPhase;
}

/**
 * 展开摘要阶段对应的领域状态，查询仍由每个所属模块执行。
 * @param phase - 可选的摘要筛选阶段。
 * @returns 未筛选时为空，否则返回可用于参数化查询的状态集合。
 */
export function runPhaseStatuses(phase?: RunPhase): string[] {
  if (!phase) return [];
  if (phase === 'active') return ['starting', 'running', 'waiting'];
  return [phase];
}
