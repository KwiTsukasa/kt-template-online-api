import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TcpReleaseMode = 'canary' | 'draining' | 'off' | 'on';
export type TcpProtocolMode = 'tcp' | 'tcp_udp' | 'udp';

export type TcpReleaseState = {
  externalPort: number;
  internalPort: number;
  natmapDesiredEnabled: boolean;
  protocolMode: TcpProtocolMode;
};

export type TcpReleaseMutation =
  | { after: TcpReleaseState; kind: 'create' }
  | { after: TcpReleaseState; before: TcpReleaseState; kind: 'update' }
  | { current: TcpReleaseState; kind: 'retry' }
  | { current: TcpReleaseState; kind: 'natmap-enable' }
  | {
      after: TcpReleaseState;
      before: TcpReleaseState;
      kind: 'natmap-disable';
    }
  | {
      after: TcpReleaseState;
      before: TcpReleaseState;
      kind: 'protocol-shrink';
    }
  | { current: TcpReleaseState; kind: 'delete' };

export class NetworkTcpReleasePolicyError extends Error {}

const INVALID_MUTATION_MESSAGE = 'Invalid TCP NATMap mutation';
const RELEASE_STATE_KEYS = [
  'externalPort',
  'internalPort',
  'natmapDesiredEnabled',
  'protocolMode',
] as const;

@Injectable()
export class NetworkTcpReleasePolicyService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 按当前运行态读取模式；当 `configured === 'canary' || configured === 'draining' || confi…` 成立时返回 `configured`。
   * @returns 当前状态对应的模式，取值为 `'off'`。
   * @throws 配置值存在但不是 `canary`、`draining`、`off` 或 `on` 时抛出 `NetworkTcpReleasePolicyError`。
   */
  readMode(): TcpReleaseMode {
    const configured = this.configService.get<string>(
      'NETWORK_TCP_NATMAP_RELEASE_MODE',
    );
    if (!configured) return 'off';
    if (
      configured === 'canary' ||
      configured === 'draining' ||
      configured === 'off' ||
      configured === 'on'
    ) {
      return configured;
    }
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap release mode');
  }

  /**
   * 按当前运行态读取金丝雀端口；从 `configService.get` 读取金丝雀端口。
   * @returns 金丝雀端口。
   */
  readCanaryPorts(): ReadonlySet<number> {
    const configured = this.configService.get<string>(
      'NETWORK_TCP_NATMAP_CANARY_PORTS',
    );
    if (!configured) return new Set();
    const ports = configured.split(',');
    const result = new Set<number>();
    for (const port of ports) {
      if (!/^[1-9]\d*$/.test(port)) this.invalidCanaryPorts();
      const value = Number(port);
      if (value > 65_535 || value === 8213 || result.has(value)) {
        this.invalidCanaryPorts();
      }
      result.add(value);
    }
    return result;
  }

  /**
   * 根据当前运行态与当前约束判定TCP可见的到管理端；从 `readMode` 读取TCP可见的到管理端。
   * @returns 满足TCP可见的到管理端约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isTcpVisibleToAdmin(): boolean {
    return this.readMode() === 'on';
  }

  /**
   * 按当前约束判定可以自动激活v2。
   * @returns 满足可以自动激活v2约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  mayAutomaticallyActivateV2(): boolean {
    const mode = this.readMode();
    return mode === 'canary' || mode === 'on';
  }

  /**
   * 按当前约束判定可以显式降级到v1。
   * @returns 满足可以显式降级到v1约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  mayExplicitlyDowngradeToV1(): boolean {
    const mode = this.readMode();
    return mode === 'draining' || mode === 'off';
  }

  /**
   * 校验`mutation`是否满足变更允许的约束，并拒绝不合法输入；当 `mode === 'canary'` 成立时直接结束且不产生返回值。
   * @param mutation - 决定变更允许的内容、边界或目标的 `mutation` 值。
   * @throws 非全量开放模式下，涉及 TCP 且不是安全清理或允许金丝雀端口的变更会抛出 `NetworkTcpReleasePolicyError`。
   */
  assertMutationAllowed(mutation: TcpReleaseMutation): void {
    this.assertMutationShape(mutation);
    const safeCleanup = this.isSafeCleanup(mutation);
    if (!this.touchesTcp(mutation)) return;

    const mode = this.readMode();
    if (mode === 'on') return;
    if (safeCleanup) return;
    if (mode === 'canary') {
      if (this.readCanaryPorts().has(this.mutationPort(mutation))) return;
      throw new NetworkTcpReleasePolicyError(
        'TCP NATMap release policy rejects this port',
      );
    }
    throw new NetworkTcpReleasePolicyError(
      'TCP NATMap release policy permits cleanup only',
    );
  }

  /**
   * 根据`value`与当前约束判定TCP是否存在。
   * @param value - 待判定是否满足TCP是否存在约束的候选值；为空时采用 `value?.protocolMode === 'tcp_udp'` 作为兜底。
   * @returns 满足TCP是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private hasTcp(value?: TcpReleaseState): boolean {
    return value?.protocolMode === 'tcp' || value?.protocolMode === 'tcp_udp';
  }

  /**
   * 校验`mutation`是否满足变更结构约束，并拒绝不合法输入；先通过 `assertExactKeys` 校验输入边界。
   * @param mutation - 决定变更结构内容、边界或目标的 `mutation` 值。
   */
  private assertMutationShape(mutation: TcpReleaseMutation): void {
    const value = this.record(mutation);
    switch (value.kind) {
      case 'create': {
        this.assertExactKeys(value, ['after', 'kind']);
        this.releaseState(value.after);
        return;
      }
      case 'update': {
        this.assertExactKeys(value, ['after', 'before', 'kind']);
        this.releaseState(value.before);
        this.releaseState(value.after);
        return;
      }
      case 'retry':
      case 'delete': {
        this.assertExactKeys(value, ['current', 'kind']);
        this.releaseState(value.current);
        return;
      }
      case 'natmap-enable': {
        this.assertExactKeys(value, ['current', 'kind']);
        const current = this.releaseState(value.current);
        if (!this.hasTcp(current) || !current.natmapDesiredEnabled) {
          this.invalidMutation();
        }
        return;
      }
      case 'natmap-disable': {
        this.assertExactKeys(value, ['after', 'before', 'kind']);
        const before = this.releaseState(value.before);
        const after = this.releaseState(value.after);
        if (
          !this.hasTcp(before) ||
          before.protocolMode !== after.protocolMode ||
          !this.portsUnchanged(before, after) ||
          !before.natmapDesiredEnabled ||
          after.natmapDesiredEnabled
        ) {
          this.invalidMutation();
        }
        return;
      }
      case 'protocol-shrink': {
        this.assertExactKeys(value, ['after', 'before', 'kind']);
        const before = this.releaseState(value.before);
        const after = this.releaseState(value.after);
        if (
          before.protocolMode !== 'tcp_udp' ||
          after.protocolMode !== 'udp' ||
          !this.portsUnchanged(before, after) ||
          after.natmapDesiredEnabled
        ) {
          this.invalidMutation();
        }
        return;
      }
    }
    this.invalidMutation();
  }

  /**
   * 根据`mutation`处理变更是否涉及 TCP。
   * @param mutation - 用于变更是否涉及 TCP的领域对象，包含 `current`、`after`、`before` 字段。
   * @returns 规范化后的变更是否涉及 TCP；主值为空时采用 `('before' in mutation && this.hasTcp(mutation.befor…` 兜底。
   */
  private touchesTcp(mutation: TcpReleaseMutation): boolean {
    if ('current' in mutation) return this.hasTcp(mutation.current);
    return (
      this.hasTcp(mutation.after) ||
      ('before' in mutation && this.hasTcp(mutation.before))
    );
  }

  /**
   * 根据`mutation`与当前约束判定安全清理；当 `mutation.kind === 'delete'` 成立时返回 `mutation.current.protocolMode === 'tcp'`。
   * @param mutation - 用于安全清理的领域对象，包含 `kind`、`current` 字段。
   * @returns 满足安全清理约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isSafeCleanup(mutation: TcpReleaseMutation): boolean {
    if (mutation.kind === 'delete') {
      return mutation.current.protocolMode === 'tcp';
    }
    return (
      mutation.kind === 'natmap-disable' || mutation.kind === 'protocol-shrink'
    );
  }

  /**
   * 按边界约束计算变更端口。
   * @param mutation - 用于按边界约束计算变更端口的领域对象，包含 `after`、`current` 字段。
   * @returns 按边界约束计算变更端口。
   */
  private mutationPort(mutation: TcpReleaseMutation): number {
    if ('after' in mutation) return mutation.after.externalPort;
    return mutation.current.externalPort;
  }

  /**
   * 根据`before`、`after`处理端口是否未变更。
   * @param before - 用于端口是否未变更的领域对象，包含 `externalPort`、`internalPort` 字段。
   * @param after - 用于端口是否未变更的领域对象，包含 `externalPort`、`internalPort` 字段。
   * @returns 端口是否未变更。
   */
  private portsUnchanged(
    before: TcpReleaseState,
    after: TcpReleaseState,
  ): boolean {
    return (
      before.externalPort === after.externalPort &&
      before.internalPort === after.internalPort
    );
  }

  /**
   * 拒绝数组与空值，并把普通对象收敛为后续 TCP 发布策略校验使用的字段记录。
   * @param value - 参与网络管理记录比较、格式化或输出的候选值。
   * @returns 返回确认不是数组或空值的普通字段记录。
   */
  private record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.invalidMutation();
    }
    return value as Record<string, unknown>;
  }

  /**
   * 校验`value`、`expected`是否满足精确键约束，并拒绝不合法输入。
   * @param value - 参与精确键比较、格式化或输出的候选值。
   * @param expected - 用于精确键的领域对象，包含 `length` 字段。
   */
  private assertExactKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
  ): void {
    const expectedKeys = new Set(expected);
    const actualKeys = Reflect.ownKeys(value);
    if (
      actualKeys.length !== expected.length ||
      actualKeys.some(
        (key) => typeof key !== 'string' || !expectedKeys.has(key),
      ) ||
      expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    ) {
      this.invalidMutation();
    }
  }

  /**
   * 校验发布状态只含四个允许字段及合法端口、协议和布尔值后返回该状态。
   * @param value - 参与发布状态只含四个允许字段及合法端口、协议和布尔值后返回该状态比较、格式化或输出的候选值。
   * @returns 返回通过精确字段、端口、布尔值与协议校验的 TCP 发布状态。
   */
  private releaseState(value: unknown): TcpReleaseState {
    const state = this.record(value);
    this.assertExactKeys(state, RELEASE_STATE_KEYS);
    const protocolMode = state.protocolMode;
    const externalPort = state.externalPort;
    const internalPort = state.internalPort;
    const natmapDesiredEnabled = state.natmapDesiredEnabled;
    if (
      protocolMode !== 'tcp' &&
      protocolMode !== 'tcp_udp' &&
      protocolMode !== 'udp'
    ) {
      this.invalidMutation();
    }
    if (!this.isPort(externalPort) || !this.isPort(internalPort)) {
      this.invalidMutation();
    }
    if (typeof natmapDesiredEnabled !== 'boolean') this.invalidMutation();
    if (protocolMode === 'udp' && natmapDesiredEnabled) this.invalidMutation();
    return state as TcpReleaseState;
  }

  /**
   * 根据`value`与当前约束判定端口。
   * @param value - 待判定是否满足端口约束的候选值。
   * @returns 满足端口约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isPort(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65_535
    );
  }

  /**
   * 以统一的发布策略异常拒绝结构非法、状态越权或不符合 TCP 发布阶段的变更。
   * @throws 调用该拒绝辅助函数时固定抛出 `NetworkTcpReleasePolicyError`，表示 TCP NATMap 变更结构非法。
   */
  private invalidMutation(): never {
    throw new NetworkTcpReleasePolicyError(INVALID_MUTATION_MESSAGE);
  }

  /**
   * 以统一异常拒绝格式错误、越界、重复或占用保留端口的 TCP NATMap 金丝雀配置。
   * @throws 调用该拒绝辅助函数时固定抛出 `NetworkTcpReleasePolicyError`，表示金丝雀端口配置非法。
   */
  private invalidCanaryPorts(): never {
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap canary ports');
  }
}
