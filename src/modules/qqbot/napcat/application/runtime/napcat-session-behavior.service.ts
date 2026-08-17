import { Injectable } from '@nestjs/common';

export type NapcatAutoCapabilityStage =
  | 'automation'
  | 'image_and_large_message'
  | 'low_risk_text'
  | 'manual_command';

export type NapcatAutomationKind =
  | 'command_reply'
  | 'event_plugin'
  | 'rule_reply';

export type NapcatAutomationDecision = {
  allowed: boolean;
  reason?: string;
};

@Injectable()
export class NapcatSessionBehaviorService {
  /**
   * 根据`accountId`、`now`构造默认资料；从 `now.getTime` 读取默认资料。
   * @param accountId - 用于精确定位账号的标识。
   * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `new Date()`。
   * @returns 包含 `accountId`、`autoCapabilityStage`、`coldStartUntil`、`housekeepingEnabled`、`housekeepingIntervalMs` 字段的默认资料。
   */
  createDefaultProfile(accountId: string, now = new Date()) {
    return {
      accountId,
      autoCapabilityStage: 'manual_command' as const,
      coldStartUntil: new Date(now.getTime() + 10 * 60_000),
      housekeepingEnabled: true,
      housekeepingIntervalMs: 30 * 60_000,
      nextHousekeepingAt: new Date(now.getTime() + 30 * 60_000),
      presenceEnabled: false,
      presenceStrategy: 'disabled',
      profileVersion: 'session-behavior-v1',
    };
  }

  /**
   * 根据`input`处理定期清理失败。
   * @param input - 定期清理失败上下文；当前保守决策固定禁用扩展并记录证据，因此不读取具体字段。
   * @returns 包含 `disableBehaviorExtensions`、`loginAction`、`recordEvidence` 字段的定期清理失败。
   */
  handleHousekeepingFailure(input: {
    accountId: string;
    failureMessage: string;
  }) {
    void input;
    return {
      disableBehaviorExtensions: true,
      loginAction: 'none' as const,
      recordEvidence: true,
    };
  }

  /**
   * 按能力顺序映射下一能力阶段。
   * @param stage - 决定按能力顺序映射下一能力阶段内容、边界或目标的 `stage` 值。
   * @returns 当前状态对应的按能力顺序映射下一能力阶段，取值为 `'low_risk_text'`、`'image_and_large_message'`、`'automation'`。
   */
  nextCapabilityStage(
    stage: NapcatAutoCapabilityStage,
  ): NapcatAutoCapabilityStage {
    if (stage === 'manual_command') return 'low_risk_text';
    if (stage === 'low_risk_text') return 'image_and_large_message';
    return 'automation';
  }

  /**
   * 决定自动化，并输出固定投影 `allowed` 字段。
   * @param input - 用于decideAutomation的结构化输入，包含 `manual`、`stage`、`automationKind` 字段。
   * @returns 包含 `allowed`、`reason` 字段的decideAutomation。
   */
  decideAutomation(input: {
    automationKind: NapcatAutomationKind;
    manual?: boolean;
    stage?: NapcatAutoCapabilityStage;
  }): NapcatAutomationDecision {
    if (input.manual || !input.stage) return { allowed: true };
    if (input.automationKind === 'command_reply') return { allowed: true };
    if (
      input.automationKind === 'rule_reply' &&
      input.stage !== 'manual_command'
    ) {
      return { allowed: true };
    }
    if (
      input.automationKind === 'event_plugin' &&
      input.stage === 'automation'
    ) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `session-behavior-stage:${input.stage}`,
    };
  }
}
