import {
  createNapcatLoginSession,
  NapcatLoginStateMachine,
} from '../../../../src/modules/qqbot/napcat';

describe('NapCat login state machine', () => {
  it('advances through quick, password, captcha, new-device, manual QR, and success states', () => {
    const machine = new NapcatLoginStateMachine();
    let session = createNapcatLoginSession({
      accountId: 'account-10001',
      hasHistoricalSession: true,
      hasSavedPassword: true,
      sessionId: 'session-1',
    });

    expect(session.stage).toBe('quick-login');
    expect(session.progressMessage).toBe('正在快速登录');

    session = machine.advance(session, { type: 'quick-login-failed' });
    expect(session.stage).toBe('password-login');
    expect(session.progressMessage).toBe('快速登录失败，进入密码登录');

    session = machine.advance(session, {
      captchaUrl: 'https://ti.qq.com/safe/tools/captcha/sms-verify-login',
      type: 'password-login-captcha-required',
    });
    expect(session.stage).toBe('captcha');
    expect(session.challenge).toEqual(
      expect.objectContaining({
        status: 'pending',
        type: 'captcha',
        url: 'https://ti.qq.com/safe/tools/captcha/sms-verify-login',
      }),
    );
    expect(session.progressMessage).toBe('需要验证码');

    session = machine.advance(session, { type: 'captcha-submitted' });
    expect(session.stage).toBe('captcha');
    expect(session.challenge).toEqual(
      expect.objectContaining({
        status: 'submitted',
        type: 'captcha',
      }),
    );
    expect(session.progressMessage).toBe('验证码已提交，等待确认');

    session = machine.advance(session, {
      newDevicePullQrCodeSig: 'sig-1',
      type: 'captcha-new-device-required',
    });
    expect(session.stage).toBe('new-device');
    expect(session.challenge).toEqual(
      expect.objectContaining({
        pullQrCodeSig: 'sig-1',
        status: 'qr-pending',
        type: 'new-device',
      }),
    );
    expect(session.progressMessage).toBe('需要新设备验证二维码');

    session = machine.advance(session, {
      qrcodeUrl: 'data:image/png;base64,qr',
      type: 'new-device-qr-ready',
    });
    expect(session.progressMessage).toBe('新设备二维码待扫码');

    session = machine.advance(session, { type: 'new-device-scanned' });
    expect(session.challenge).toEqual(
      expect.objectContaining({ status: 'scanned' }),
    );
    expect(session.progressMessage).toBe('新设备二维码已扫码');

    session = machine.advance(session, { type: 'new-device-confirming' });
    expect(session.challenge).toEqual(
      expect.objectContaining({ status: 'confirming' }),
    );
    expect(session.progressMessage).toBe('新设备确认中');

    session = machine.advance(session, { type: 'new-device-verified' });
    expect(session.stage).toBe('password-login');
    expect(session.challenge).toBeUndefined();
    expect(session.progressMessage).toBe('新设备验证成功，继续登录');

    session = machine.advance(session, { type: 'manual-qr-required' });
    expect(session.stage).toBe('manual-qr');
    expect(session.progressMessage).toBe('正在生成手动二维码');

    session = machine.advance(session, {
      selfId: '10001',
      type: 'login-success',
    });
    expect(session.stage).toBe('success');
    expect(session.status).toBe('success');
    expect(session.progressMessage).toBe('登录成功');
  });

  it('keeps captcha and new-device challenges pending until resolved, expired, or failed', () => {
    const machine = new NapcatLoginStateMachine();
    let session = createNapcatLoginSession({
      accountId: 'account-10001',
      hasHistoricalSession: false,
      hasSavedPassword: true,
      sessionId: 'session-2',
    });

    expect(session.stage).toBe('password-login');
    session = machine.advance(session, {
      captchaUrl: 'https://ti.qq.com/safe/tools/captcha/sms-verify-login',
      type: 'password-login-captcha-required',
    });
    session = machine.advance(session, { type: 'captcha-still-required' });
    expect(session.challenge).toEqual(
      expect.objectContaining({
        status: 'pending',
        type: 'captcha',
        url: 'https://ti.qq.com/safe/tools/captcha/sms-verify-login',
      }),
    );

    session = machine.advance(session, {
      newDevicePullQrCodeSig: 'sig-2',
      type: 'captcha-new-device-required',
    });
    session = machine.advance(session, { type: 'new-device-poll-pending' });
    expect(session.challenge).toEqual(
      expect.objectContaining({
        pullQrCodeSig: 'sig-2',
        status: 'qr-pending',
        type: 'new-device',
      }),
    );

    session = machine.advance(session, {
      reason: '二维码已过期',
      type: 'new-device-expired',
    });
    expect(session.status).toBe('pending');
    expect(session.challenge).toEqual(
      expect.objectContaining({
        reason: '二维码已过期',
        status: 'expired',
      }),
    );
  });

  it('treats runtime cleanup failure as a terminal login failure', () => {
    const machine = new NapcatLoginStateMachine();
    let session = createNapcatLoginSession({
      accountId: 'account-10001',
      hasHistoricalSession: true,
      hasSavedPassword: true,
      sessionId: 'session-3',
    });

    session = machine.advance(session, {
      reason: 'NAPCAT_QUICK_PASSWORD cleanup failed',
      type: 'runtime-cleanup-failed',
    });
    expect(session.stage).toBe('cleanup-failed');
    expect(session.status).toBe('failure');
    expect(session.progressMessage).toBe('运行态清理失败');

    session = machine.advance(session, {
      selfId: '10001',
      type: 'login-success',
    });
    expect(session.stage).toBe('cleanup-failed');
    expect(session.status).toBe('failure');
    expect(session.progressMessage).toBe('运行态清理失败');
  });
});
