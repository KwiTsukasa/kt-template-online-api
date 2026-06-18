import { NapcatSessionBehaviorService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-session-behavior.service';

describe('NapCat session behavior profile', () => {
  it('keeps cold-start staged capability separate from send budgets', () => {
    const service = new NapcatSessionBehaviorService();
    const profile = service.createDefaultProfile(
      'account-1',
      new Date('2026-06-18T03:00:00.000Z'),
    );

    expect(profile).toMatchObject({
      accountId: 'account-1',
      autoCapabilityStage: 'manual_command',
      housekeepingEnabled: true,
      presenceEnabled: false,
    });
    expect(JSON.stringify(profile)).not.toMatch(/daily|hour|quota|budget/i);
  });

  it('does not trigger login reset, password retry, docker recreate, or QR refresh on housekeeping failure', () => {
    const service = new NapcatSessionBehaviorService();
    const decision = service.handleHousekeepingFailure({
      accountId: 'account-1',
      failureMessage: 'NapCat status API timeout',
    });

    expect(decision).toEqual({
      disableBehaviorExtensions: true,
      loginAction: 'none',
      recordEvidence: true,
    });
  });

  it('steps capability recovery from manual command to automation only after windows pass', () => {
    const service = new NapcatSessionBehaviorService();

    expect(service.nextCapabilityStage('manual_command')).toBe('low_risk_text');
    expect(service.nextCapabilityStage('low_risk_text')).toBe(
      'image_and_large_message',
    );
    expect(service.nextCapabilityStage('image_and_large_message')).toBe(
      'automation',
    );
    expect(service.nextCapabilityStage('automation')).toBe('automation');
  });

  it('allows manual command paths while blocking cold-start event automation', () => {
    const service = new NapcatSessionBehaviorService();

    expect(
      service.decideAutomation({
        automationKind: 'command_reply',
        stage: 'manual_command',
      }),
    ).toEqual({ allowed: true });
    expect(
      service.decideAutomation({
        automationKind: 'rule_reply',
        stage: 'manual_command',
      }),
    ).toEqual({
      allowed: false,
      reason: 'session-behavior-stage:manual_command',
    });
    expect(
      service.decideAutomation({
        automationKind: 'event_plugin',
        stage: 'manual_command',
      }),
    ).toEqual({
      allowed: false,
      reason: 'session-behavior-stage:manual_command',
    });
  });
});
