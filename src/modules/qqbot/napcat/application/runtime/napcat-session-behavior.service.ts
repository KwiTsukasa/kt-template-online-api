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

  nextCapabilityStage(
    stage: NapcatAutoCapabilityStage,
  ): NapcatAutoCapabilityStage {
    if (stage === 'manual_command') return 'low_risk_text';
    if (stage === 'low_risk_text') return 'image_and_large_message';
    return 'automation';
  }

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
