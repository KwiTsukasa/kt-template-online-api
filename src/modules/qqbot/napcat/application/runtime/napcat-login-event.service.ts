import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  NapcatLoginEvent,
  type NapcatLoginEventKind,
  type NapcatLoginEventSource,
  type NapcatLoginEventStatus,
} from '../../infrastructure/persistence/napcat-login-event.entity';

const NAPCAT_AUTOMATIC_RECOVERY_BLOCKING_EVENTS: NapcatLoginEventKind[] = [
  'captcha_required',
  'manual_qr_created',
  'new_device_required',
  'recovery_suspended',
];

export type NapcatAutomaticRecoveryGate = {
  allowed: boolean;
  reason?: NapcatLoginEventKind;
};

@Injectable()
export class NapcatLoginEventService {
  /**
   * Initializes login-event persistence.
   * @param loginEventRepository - Repository used to append login-side audit and recovery-gating events.
   */
  constructor(
    @InjectRepository(NapcatLoginEvent)
    private readonly loginEventRepository: Repository<NapcatLoginEvent>,
  ) {}

  /**
   * Records a login-side event for audit, automatic recovery gating, and Admin evidence.
   * @param input - Event payload produced by Admin actions, watchdog, runtime checks, or system workflows.
   * @returns Persisted login-event row created from the append-only payload.
   */
  async record(input: {
    accountId: string;
    containerId?: null | string;
    eventKind: NapcatLoginEventKind;
    eventSource: NapcatLoginEventSource;
    eventStatus: NapcatLoginEventStatus;
    evidence?: Record<string, unknown>;
  }) {
    return this.loginEventRepository.save(
      this.loginEventRepository.create({
        accountId: input.accountId,
        containerId: input.containerId || null,
        eventKind: input.eventKind,
        eventSource: input.eventSource,
        eventStatus: input.eventStatus,
        evidence: input.evidence || null,
      }),
    );
  }

  /**
   * Records that automation stopped before QR, captcha, or new-device verification.
   * @param input - Account, container, source, and domain reason explaining why watchdog recovery must stop.
   * @returns Persisted `recovery_suspended` event carrying the blocking reason in evidence.
   */
  recordSuspended(input: {
    accountId: string;
    containerId?: null | string;
    evidence: Record<string, unknown>;
    reason: NapcatLoginEventKind;
    source: NapcatLoginEventSource;
  }) {
    return this.record({
      accountId: input.accountId,
      containerId: input.containerId,
      eventKind: 'recovery_suspended',
      eventSource: input.source,
      eventStatus: 'blocked',
      evidence: {
        ...input.evidence,
        reason: input.reason,
      },
    });
  }

  /**
   * Checks whether watchdog may run quick -> password recovery for an account/container pair.
   * @param input - Account, optional container, and latest successful connection time used as manual reset evidence.
   * @returns Recovery gate result; blocked reasons map to the latest blocking login-side event.
   */
  async canAttemptAutomaticRecovery(input: {
    accountId: string;
    containerId?: null | string;
    resetAfter?: Date | null;
  }): Promise<NapcatAutomaticRecoveryGate> {
    const where: Record<string, unknown> = {
      accountId: input.accountId,
      eventKind: In(NAPCAT_AUTOMATIC_RECOVERY_BLOCKING_EVENTS),
    };
    if (input.containerId) where.containerId = input.containerId;

    const latest = await this.loginEventRepository.findOne({
      order: { createTime: 'DESC' },
      where: where as any,
    });
    if (!latest) return { allowed: true };

    if (this.isResetAfterEvent(input.resetAfter, latest.createTime)) {
      return { allowed: true };
    }
    if (this.hasManualResetEvidence(latest.evidence)) {
      return { allowed: true };
    }

    return { allowed: false, reason: latest.eventKind };
  }

  /**
   * Compares a later successful connection against the blocking event timestamp.
   * @param resetAfter - Successful connection or manual reset time from account state.
   * @param eventTime - Blocking login-event creation time.
   * @returns Whether the reset timestamp is newer than the blocking event.
   */
  private isResetAfterEvent(
    resetAfter: Date | null | undefined,
    eventTime: Date,
  ) {
    if (!resetAfter) return false;
    const resetAt = new Date(resetAfter).getTime();
    const blockedAt = new Date(eventTime).getTime();
    return Number.isFinite(resetAt) && resetAt > blockedAt;
  }

  /**
   * Detects explicit manual reset evidence embedded in a blocking event.
   * @param evidence - Login event evidence object persisted with the blocking event.
   * @returns Whether automation can continue because a human reset has been recorded.
   */
  private hasManualResetEvidence(evidence: null | Record<string, unknown>) {
    if (!evidence) return false;
    return Boolean(evidence.manualResetAt || evidence.manualReset);
  }
}
