import {
  NATMAP_PORT_HELP_TEXT,
  NATMAP_PORT_QUERY_POLICY,
} from '../config/natmap-port-policy';
import type {
  NatmapEndpointResolution,
  NatmapEndpointSnapshot,
  NatmapPortQueryResult,
  NatmapPortQueryStatus,
  NatmapPortSelector,
} from '../domain/natmap-port.types';
import type { NatmapPortPluginHost } from '../infrastructure/integration/natmap-port-host';

export class NatmapPortApplication {
  constructor(private readonly host: NatmapPortPluginHost) {}

  /**
   * 解析命令参数并查询一次脱敏端点快照，对 Host 异常、过期租约与不唯一通道返回固定中文状态。
   * @param input - Bot 命令核心传入的 `raw`、`text` 与 `args` 参数投影。
   * @returns 固定包含状态、回复文本、通道、端口和时间字段的查询结果。
   */
  async query(input: Record<string, unknown>): Promise<NatmapPortQueryResult> {
    const selector = this.parseSelector(input);
    if (selector.kind === 'help') {
      return this.buildResult('help', NATMAP_PORT_HELP_TEXT);
    }
    if (selector.kind === 'invalid') {
      return this.buildResult(
        'invalid',
        `参数无效。\n${NATMAP_PORT_HELP_TEXT}`,
      );
    }

    let rawResolution: unknown;
    try {
      rawResolution = await this.host.resolveNatmapEndpoint({
        selector: selector.value,
      });
    } catch {
      return this.buildResult(
        'unavailable',
        'NATMap 实时状态暂不可用，请稍后再试。',
      );
    }
    const resolution = this.normalizeResolution(rawResolution);
    if (!resolution) {
      return this.buildResult(
        'unavailable',
        'NATMap 实时状态暂不可用，请稍后再试。',
      );
    }
    if (resolution.kind === 'empty') {
      return this.buildResult('empty', '当前没有已启用的 TCP NATMap 通道。');
    }
    if (resolution.kind === 'ambiguous') {
      return this.buildResult(
        'ambiguous',
        `检测到 ${resolution.channelCount} 个 NATMap 通道，请指定已知通道名称。`,
      );
    }
    if (resolution.kind === 'not-found') {
      return this.buildResult('not-found', '未找到指定 NATMap 通道。');
    }
    return this.renderEndpoint(resolution.endpoint);
  }

  /**
   * 从三种兼容输入字段读取完整通道选择器，帮助词单独分流，控制字符或超长文本直接拒绝。
   * @param input - Bot 命令参数对象。
   * @returns 帮助、非法或可查询三态选择器。
   */
  private parseSelector(input: Record<string, unknown>): NatmapPortSelector {
    const raw = this.readRawText(input);
    const normalized = raw.replaceAll(/\s+/gu, ' ').trim();
    if (
      normalized.length > NATMAP_PORT_QUERY_POLICY.maxSelectorLength ||
      /[\u0000-\u001f\u007f]/u.test(normalized) ||
      NATMAP_PORT_QUERY_POLICY.sensitiveSelectorPattern.test(normalized)
    ) {
      return { kind: 'invalid' };
    }
    if (
      NATMAP_PORT_QUERY_POLICY.helpTokens.includes(normalized.toLowerCase())
    ) {
      return { kind: 'help' };
    }
    return { kind: 'query', value: normalized };
  }

  /**
   * 按 `raw`、`text`、`args` 优先级读取命令正文，未知结构回退为空选择器。
   * @param input - Bot 命令参数对象。
   * @returns 尚未折叠空白的原始参数文本。
   */
  private readRawText(input: Record<string, unknown>) {
    if (typeof input.raw === 'string') return input.raw;
    if (typeof input.text === 'string') return input.text;
    if (Array.isArray(input.args)) {
      return input.args.map((item) => `${item || ''}`).join(' ');
    }
    return '';
  }

  /**
   * 校验 Host 的空、不唯一、未找到与单端点四态结果，拒绝额外名称目录或异常计数。
   * @param value - Host 返回的未知解析结果。
   * @returns 合法解析结果；结构不符时返回 `null`。
   */
  private normalizeResolution(value: unknown): NatmapEndpointResolution | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const candidate = value as Record<string, unknown>;
    if (candidate.kind === 'empty') return { kind: 'empty' };
    if (candidate.kind === 'ambiguous' || candidate.kind === 'not-found') {
      if (
        !Number.isInteger(candidate.channelCount) ||
        Number(candidate.channelCount) < 1 ||
        Number(candidate.channelCount) > 16
      ) {
        return null;
      }
      return {
        channelCount: Number(candidate.channelCount),
        kind: candidate.kind,
      };
    }
    if (candidate.kind !== 'found') return null;
    const endpoint = this.normalizeEndpoint(candidate.endpoint);
    if (!endpoint) return null;
    return { endpoint, kind: 'found' };
  }

  /**
   * 校验单个脱敏端点；当前态必须有有效端口与两个时间，非当前态不得携带旧端口。
   * @param value - 待校验的单个 Host 端点。
   * @returns 合法端点或 `null`。
   */
  private normalizeEndpoint(value: unknown): NatmapEndpointSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const candidate = value as Record<string, unknown>;
    const label = `${candidate.label || ''}`.trim();
    if (
      !label ||
      label.length > NATMAP_PORT_QUERY_POLICY.maxSelectorLength ||
      NATMAP_PORT_QUERY_POLICY.sensitiveSelectorPattern.test(label)
    ) {
      return null;
    }
    if (!['current', 'stale', 'unavailable'].includes(`${candidate.status}`)) {
      return null;
    }
    const status = candidate.status as NatmapEndpointSnapshot['status'];
    if (status === 'current') {
      if (
        !Number.isInteger(candidate.publicPort) ||
        Number(candidate.publicPort) < 1 ||
        Number(candidate.publicPort) > 65_535 ||
        !this.isTimestamp(candidate.observedAt) ||
        !this.isTimestamp(candidate.validUntil)
      ) {
        return null;
      }
      return {
        label,
        observedAt: `${candidate.observedAt}`,
        publicPort: Number(candidate.publicPort),
        status,
        validUntil: `${candidate.validUntil}`,
      };
    }
    if (candidate.publicPort !== null) return null;
    let observedAt: null | string = null;
    if (candidate.observedAt !== null) {
      if (!this.isTimestamp(candidate.observedAt)) return null;
      observedAt = `${candidate.observedAt}`;
    }
    return {
      label,
      observedAt,
      publicPort: null,
      status,
      validUntil: null,
    };
  }

  /**
   * 把选中的权威端点渲染为固定中文回复；过期或不可用状态不输出旧端口。
   * @param endpoint - 唯一选中的脱敏端点。
   * @returns 当前、过期或不可用查询结果。
   */
  private renderEndpoint(
    endpoint: NatmapEndpointSnapshot,
  ): NatmapPortQueryResult {
    if (endpoint.status === 'current') {
      return this.buildResult(
        'current',
        [
          'NATMap 动态端口',
          `通道：${endpoint.label}`,
          '协议：TCP',
          `端口：${endpoint.publicPort}`,
          `采集时间（UTC）：${endpoint.observedAt}`,
          `有效至（UTC）：${endpoint.validUntil}`,
        ].join('\n'),
        endpoint,
      );
    }
    if (endpoint.status === 'stale') {
      let replyText = `通道“${endpoint.label}”的 NATMap 状态已过期，请等待 Agent 上报。`;
      if (endpoint.observedAt) {
        replyText += `\n最后采集（UTC）：${endpoint.observedAt}`;
      }
      return this.buildResult('stale', replyText, endpoint);
    }
    return this.buildResult(
      'unavailable',
      `通道“${endpoint.label}”暂无可用 NATMap 实时端口。`,
      endpoint,
    );
  }

  /**
   * 生成固定六字段输出，只有当前有效端点能够携带端口与有效期。
   * @param status - 对外稳定查询状态。
   * @param replyText - 已完成脱敏的中文回复。
   * @param endpoint - 可选的目标端点。
   * @returns 固定输出投影。
   */
  private buildResult(
    status: NatmapPortQueryStatus,
    replyText: string,
    endpoint?: NatmapEndpointSnapshot,
  ): NatmapPortQueryResult {
    let channel: null | string = null;
    let observedAt: null | string = null;
    let publicPort: null | number = null;
    let validUntil: null | string = null;
    if (endpoint) {
      channel = endpoint.label;
      observedAt = endpoint.observedAt;
      if (endpoint.status === 'current') {
        publicPort = endpoint.publicPort;
        validUntil = endpoint.validUntil;
      }
    }
    return {
      channel,
      observedAt,
      publicPort,
      replyText,
      status,
      validUntil,
    };
  }

  /**
   * 拒绝空值、非字符串与非法日期，避免 worker 的异常时间进入端口租约回复。
   * @param value - 待检查的时间字段。
   * @returns 可解析为有效时间时返回 `true`。
   */
  private isTimestamp(value: unknown) {
    if (typeof value !== 'string' || !value) return false;
    return Number.isFinite(new Date(value).getTime());
  }
}
