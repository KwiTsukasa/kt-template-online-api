import axios from 'axios';
import {
  errorEvidence,
  liveEvidence,
  unwiredEvidence,
} from '../environment-dashboard-evidence.mapper';
import type {
  EnvironmentHealthStatus,
  EnvironmentSignal,
} from '../../domain/environment-dashboard.types';

/**
 * 根据`id`、`label`、`missingKeys`构造未接线的适配器信号。
 * @param id - 决定未接线的适配器信号内容、边界或目标的 `id` 值。
 * @param label - 决定未接线的适配器信号内容、边界或目标的 `label` 值。
 * @param missingKeys - 用于批量校验或读取未接线的适配器信号的键集合。
 * @returns 包含 `evidence`、`id`、`label`、`sourceKind`、`status` 字段的未接线的适配器信号。
 */
export function createUnwiredAdapterSignal(
  id: string,
  label: string,
  missingKeys: string[],
): EnvironmentSignal {
  return {
    evidence: [unwiredEvidence(label, missingKeys)],
    id,
    label,
    sourceKind: 'unwired',
    status: 'unwired',
    summary: '只读观测配置未接入',
  };
}

/**
 * 根据`id`、`label`、`summary`构造实时适配器信号。
 * @param id - 决定实时适配器信号内容、边界或目标的 `id` 值。
 * @param label - 决定实时适配器信号内容、边界或目标的 `label` 值。
 * @param summary - 决定实时适配器信号内容、边界或目标的 `summary` 值。
 * @param metadata - 决定实时适配器信号内容、边界或目标的 `metadata` 值；省略时默认采用 `{}`。
 * @param status - 决定实时适配器信号内容、边界或目标的 `status` 值；省略时默认采用 `'ok'`。
 * @param observedAt - 用于过期、排序或租约判定的时间基准；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `evidence`、`id`、`label`、`observedAt`、`sourceKind` 字段的实时适配器信号。
 */
export function createLiveAdapterSignal(
  id: string,
  label: string,
  summary: string,
  metadata: Record<string, unknown> = {},
  status: EnvironmentHealthStatus = 'ok',
  observedAt?: Date | number | string,
): EnvironmentSignal {
  const evidence = liveEvidence(label, summary, observedAt, metadata);
  return {
    evidence: [evidence],
    id,
    label,
    observedAt: evidence.observedAt,
    sourceKind: 'live',
    status,
    summary,
  };
}

/**
 * 根据`id`、`label`、`error`构造错误适配器信号。
 * @param id - 决定错误适配器信号内容、边界或目标的 `id` 值。
 * @param label - 决定错误适配器信号内容、边界或目标的 `label` 值。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 包含 `evidence`、`id`、`label`、`observedAt`、`sourceKind` 字段的错误适配器信号。
 */
export function createErrorAdapterSignal(
  id: string,
  label: string,
  error: unknown,
): EnvironmentSignal {
  const evidence = errorEvidence(label, error);
  return {
    evidence: [evidence],
    id,
    label,
    observedAt: evidence.observedAt,
    sourceKind: 'derived',
    status: 'degraded',
    summary: evidence.summary,
  };
}

/**
 * 把 Axios 的认证失败与超时收敛为稳定脱敏摘要，其余异常继续沿用通用错误证据。
 * @param id - 环境信号稳定标识。
 * @param label - 环境信号展示名称。
 * @param error - 只读 HTTP client 抛出的未知异常。
 * @returns 不含请求头、凭据、URL 或响应正文的降级环境信号。
 */
export function createReadonlyHttpFailureSignal(
  id: string,
  label: string,
  error: unknown,
): EnvironmentSignal {
  if (axios.isAxiosError(error)) {
    const httpStatus = error.response?.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return createErrorAdapterSignal(
        id,
        label,
        new Error(`只读认证失败 (HTTP ${httpStatus})`),
      );
    }
    const message = String(error.message || '').toLowerCase();
    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      message.includes('timeout')
    ) {
      return createErrorAdapterSignal(id, label, new Error('只读观测请求超时'));
    }
  }
  return createErrorAdapterSignal(id, label, error);
}

/**
 * 根据`status`与当前约束判定只读的HTTP成功。
 * @param status - 决定只读的HTTP成功内容、边界或目标的 `status` 值。
 * @returns 满足只读的HTTP成功约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isReadonlyHttpOk(status: number): boolean {
  return status >= 200 && status < 400;
}

/**
 * 把受控基础地址与路径拼接为只读 URL。
 * @param baseUrl - 待规范化、请求或同源校验的baseURL 地址 URL。
 * @param path - 必须保持在受控根目录内的路径。
 * @returns 把受控基础地址与路径拼接为只读 URL。
 */
export function joinReadonlyUrl(baseUrl: string, path: string): string {
  const normalizedBase = (() => {
    if (baseUrl.endsWith('/')) {
      return baseUrl;
    }
    return `${baseUrl}/`;
  })();
  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString();
}

/**
 * 将受限响应预览解析为普通 JSON 对象；空文本、非法 JSON、数组或标量统一回退为空对象。
 * @param bodyPreview - 决定JSON预览内容、边界或目标的 `bodyPreview` 值。
 * @returns JSON预览。
 */
export function parseJsonPreview(bodyPreview: string): Record<string, unknown> {
  if (!bodyPreview) return {};
  try {
    const parsed = JSON.parse(bodyPreview);
    return asRecord(parsed) || {};
  } catch {
    return {};
  }
}

/**
 * 将输入收敛并投影为记录。
 * @param value - 参与记录比较、格式化或输出的候选值。
 * @returns 记录；没有可用结果或提前结束时为 `undefined`。
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * 将输入收敛并投影为数组。
 * @param value - 参与数组比较、格式化或输出的候选值。
 * @returns 按输入顺序得到的数组列表；没有匹配项时为空数组。
 */
export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

/**
 * 将输入收敛并投影为字符串。
 * @param value - 参与字符串比较、格式化或输出的候选值。
 * @returns 按参数编码并拼接完成的字符串；没有可用结果或提前结束时为 `undefined`。
 */
export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return `${value}`;
  return undefined;
}

/**
 * 将输入收敛并投影为数字。
 * @param value - 参与数字比较、格式化或输出的候选值。
 * @returns 数字；没有可用结果或提前结束时为 `undefined`。
 */
export function asNumber(value: unknown): number | undefined {
  const numberValue = (() => {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return Number(value);
    }
    return Number.NaN;
  })();
  if (Number.isFinite(numberValue)) {
    return numberValue;
  }
  return undefined;
}
