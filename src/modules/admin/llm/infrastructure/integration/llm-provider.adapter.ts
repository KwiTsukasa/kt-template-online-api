import { Inject, Injectable } from '@nestjs/common';
import type {
  LlmAdapterConfig,
  LlmModelCapabilityOption,
  LlmModelItem,
  LlmNormalizedStreamEvent,
  LlmProvider,
  LlmStreamRequest,
} from '../../contract/llm.types';

export class LlmModelDiscoveryError extends Error {}

/**
 * 规范供应商声明的模型级能力选项，并拒绝空标识、重复项之外的结构漂移。
 * @param value - 可选能力数组；缺失时表示供应商协议未声明该能力。
 * @param errorMessage - 协议非法时使用的脱敏错误。
 * @returns 按首次出现顺序保留的非空能力标识和标签。
 * @throws {LlmModelDiscoveryError} 数组或任一能力项结构不合法时抛出。
 */
function normalizeCapabilityOptions(
  value: unknown,
  errorMessage: string,
): LlmModelCapabilityOption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new LlmModelDiscoveryError(errorMessage);
  const options: LlmModelCapabilityOption[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new LlmModelDiscoveryError(errorMessage);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string') {
      throw new LlmModelDiscoveryError(errorMessage);
    }
    const id = record.id.trim();
    if (!id || seen.has(id)) continue;
    let label = id;
    if (record.label !== undefined && record.label !== null) {
      if (typeof record.label !== 'string') {
        throw new LlmModelDiscoveryError(errorMessage);
      }
      const normalizedLabel = record.label.trim();
      if (normalizedLabel) label = normalizedLabel;
    }
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

/**
 * 校验模型默认能力值属于供应商实时声明的选项；缺失时保持 null 让上游使用自身默认值。
 * @param value - 供应商返回的可选默认能力标识。
 * @param options - 同一模型已规范化的能力选项。
 * @param errorMessage - 协议非法时使用的脱敏错误。
 * @returns 合法默认标识或 null。
 * @throws {LlmModelDiscoveryError} 默认值类型非法或未被选项声明时抛出。
 */
function normalizeDefaultCapability(
  value: unknown,
  options: LlmModelCapabilityOption[],
  errorMessage: string,
): null | string {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new LlmModelDiscoveryError(errorMessage);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (!options.some((option) => option.id === normalized)) {
    throw new LlmModelDiscoveryError(errorMessage);
  }
  return normalized;
}

/**
 * 将供应商模型对象规范为非空且按 ID 去重的统一目录，并拒绝字段类型异常的协议响应。
 * @param values - 供应商模型数组或待验证的未知响应字段。
 * @param errorMessage - 协议无效或规范化后为空时使用的安全错误文本。
 * @param labelProperty - 供应商模型对象中承载展示名称的字段名。
 * @returns 保留首次出现顺序的统一模型目录。
 * @throws {LlmModelDiscoveryError} 响应不是数组、模型字段类型非法或目录为空时抛出。
 */
export function normalizeLlmModelItems(
  values: unknown,
  errorMessage: string,
  labelProperty = 'label',
): LlmModelItem[] {
  if (!Array.isArray(values)) throw new LlmModelDiscoveryError(errorMessage);
  const items: LlmModelItem[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new LlmModelDiscoveryError(errorMessage);
    }
    const record = value as Record<string, unknown>;
    if (record.id === undefined || record.id === null) continue;
    if (typeof record.id !== 'string') {
      throw new LlmModelDiscoveryError(errorMessage);
    }
    const id = record.id.trim();
    if (!id || seen.has(id)) continue;
    let label = id;
    const rawLabel = record[labelProperty];
    if (rawLabel !== undefined && rawLabel !== null) {
      if (typeof rawLabel !== 'string') {
        throw new LlmModelDiscoveryError(errorMessage);
      }
      const normalizedLabel = rawLabel.trim();
      if (normalizedLabel) label = normalizedLabel;
    }
    const reasoningEfforts = normalizeCapabilityOptions(
      record.reasoningEfforts,
      errorMessage,
    );
    const serviceTiers = normalizeCapabilityOptions(
      record.serviceTiers,
      errorMessage,
    );
    const defaultReasoningEffort = normalizeDefaultCapability(
      record.defaultReasoningEffort,
      reasoningEfforts,
      errorMessage,
    );
    const defaultServiceTier = normalizeDefaultCapability(
      record.defaultServiceTier,
      serviceTiers,
      errorMessage,
    );
    seen.add(id);
    items.push({
      defaultReasoningEffort,
      defaultServiceTier,
      id,
      label,
      reasoningEfforts,
      serviceTiers,
    });
  }
  if (items.length === 0) throw new LlmModelDiscoveryError(errorMessage);
  return items;
}

export abstract class LlmProviderAdapter {
  /**
   * 使用当前连接凭据实时读取供应商模型目录。
   * @param config - 已校验并解密的供应商连接配置。
   * @returns 规范化且非空的实时模型目录。
   * @throws {LlmModelDiscoveryError} 请求失败、响应协议非法或目录为空时抛出安全错误。
   */
  abstract fetchModels(config: LlmAdapterConfig): Promise<LlmModelItem[]>;
  abstract supports(provider: LlmProvider): boolean;
  abstract stream(
    request: LlmStreamRequest,
  ): AsyncGenerator<LlmNormalizedStreamEvent>;
}

export const LLM_PROVIDER_ADAPTERS = Symbol('LLM_PROVIDER_ADAPTERS');

@Injectable()
export class LlmProviderAdapterRegistry {
  constructor(
    @Inject(LLM_PROVIDER_ADAPTERS)
    private readonly adapters: LlmProviderAdapter[],
  ) {}

  /**
   * 按供应商选择唯一流式适配器，缺少实现时失败关闭。
   * @param provider - 当前连接声明的供应商。
   * @returns 唯一支持该供应商的流式适配器。
   * @throws 未找到或找到多个适配器时抛出错误。
   */
  resolve(provider: LlmProvider): LlmProviderAdapter {
    const matched = this.adapters.filter((adapter) =>
      adapter.supports(provider),
    );
    if (matched.length !== 1) {
      throw new Error(`llm-provider-adapter-invalid:${provider}`);
    }
    return matched[0];
  }
}
