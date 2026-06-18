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
   * Creates the first behavior profile after account login or profile migration.
   * @param accountId - Account id whose automation stage and housekeeping schedule are initialized.
   * @param now - Current time supplied by caller for deterministic tests and evidence.
   * @returns Default cold-start behavior profile without any send quota counters.
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
   * Converts housekeeping failure into an evidence-only action.
   * @param input - Account and failure summary from a low-side-effect housekeeping call.
   * @returns Decision that disables behavior extensions without resetting login, retrying password, recreating runtime, or refreshing QR.
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
   * Calculates the next automation recovery stage after the current observation window passes.
   * @param stage - Current staged capability value persisted for the account.
   * @returns Next capability stage, capped at full automation.
   */
  nextCapabilityStage(
    stage: NapcatAutoCapabilityStage,
  ): NapcatAutoCapabilityStage {
    if (stage === 'manual_command') return 'low_risk_text';
    if (stage === 'low_risk_text') return 'image_and_large_message';
    return 'automation';
  }

  /**
   * Decides whether a behavior extension may run for the current staged capability.
   * @param input - Automation kind and optional stage; missing stage means no persisted behavior profile is active yet.
   * @returns Allow/skip decision that never writes or checks hourly/daily send counters.
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
