export type NapcatLoginSessionStatus = 'failure' | 'pending' | 'success';

export type NapcatLoginStage =
  | 'captcha'
  | 'cleanup-failed'
  | 'failure'
  | 'manual-qr'
  | 'new-device'
  | 'password-login'
  | 'quick-login'
  | 'success';

export type NapcatLoginChallenge =
  | {
      reason?: string;
      status: 'failed' | 'pending' | 'submitted';
      type: 'captcha';
      url: string;
    }
  | {
      pullQrCodeSig?: string;
      qrcodeUrl?: string;
      reason?: string;
      status: 'confirming' | 'expired' | 'failed' | 'qr-pending' | 'scanned';
      type: 'new-device';
    };

export type NapcatLoginSessionState = {
  accountId: string;
  challenge?: NapcatLoginChallenge;
  hasHistoricalSession: boolean;
  hasSavedPassword: boolean;
  progressMessage: string;
  selfId?: string;
  sessionId: string;
  stage: NapcatLoginStage;
  status: NapcatLoginSessionStatus;
};

export type CreateNapcatLoginSessionInput = {
  accountId: string;
  hasHistoricalSession: boolean;
  hasSavedPassword: boolean;
  sessionId: string;
};

export type NapcatLoginStateEvent =
  | { type: 'captcha-still-required' }
  | { type: 'captcha-submitted' }
  | { newDevicePullQrCodeSig?: string; type: 'captcha-new-device-required' }
  | { reason?: string; type: 'login-failed' }
  | { selfId?: string; type: 'login-success' }
  | { type: 'manual-qr-required' }
  | { captchaUrl: string; type: 'password-login-captcha-required' }
  | { type: 'password-login-failed' }
  | { type: 'quick-login-failed' }
  | { qrcodeUrl?: string; type: 'new-device-qr-ready' }
  | { type: 'new-device-scanned' }
  | { type: 'new-device-confirming' }
  | { type: 'new-device-poll-pending' }
  | { type: 'new-device-verified' }
  | { reason?: string; type: 'new-device-expired' }
  | { reason?: string; type: 'new-device-failed' }
  | { reason?: string; type: 'runtime-cleanup-failed' };

export const NAPCAT_LOGIN_PROGRESS_MESSAGES = {
  captchaNeeded: '需要验证码',
  captchaSubmitted: '验证码已提交，等待确认',
  cleanupFailed: '运行态清理失败',
  failed: '登录失败',
  manualQr: '正在生成手动二维码',
  newDeviceConfirming: '新设备确认中',
  newDeviceNeeded: '需要新设备验证二维码',
  newDeviceQrPending: '新设备二维码待扫码',
  newDeviceScanned: '新设备二维码已扫码',
  newDeviceVerified: '新设备验证成功，继续登录',
  passwordLogin: '正在密码登录',
  quickLogin: '正在快速登录',
  quickToPassword: '快速登录失败，进入密码登录',
  success: '登录成功',
} as const;

/**
 * 根据历史会话是否存在选择快速或密码登录阶段，并创建初始待处理登录状态。
 * @param input - 用于NapCatLogin会话的结构化输入，包含 `hasHistoricalSession`、`accountId`、`hasSavedPassword`、`sessionId` 字段。
 * @returns 包含 `accountId`、`hasHistoricalSession`、`hasSavedPassword`、`progressMessage`、`sessionId` 字段的NapCatLogin会话。
 */
export function createNapcatLoginSession(
  input: CreateNapcatLoginSessionInput,
): NapcatLoginSessionState {
  const stage = (() => {
    if (input.hasHistoricalSession) {
      return 'quick-login';
    }
    return 'password-login';
  })();

  return {
    accountId: input.accountId,
    hasHistoricalSession: input.hasHistoricalSession,
    hasSavedPassword: input.hasSavedPassword,
    progressMessage: (() => {
      if (input.hasHistoricalSession) {
        return NAPCAT_LOGIN_PROGRESS_MESSAGES.quickLogin;
      }
      return NAPCAT_LOGIN_PROGRESS_MESSAGES.passwordLogin;
    })(),
    sessionId: input.sessionId,
    stage,
    status: 'pending',
  };
}

export class NapcatLoginStateMachine {
  /**
   * 根据`session`、`event`处理advance；当 `session.challenge?.type === 'captcha'` 成立时返回 `{ ...session, challenge: { ...session.chall…`。
   * @param session - 待读取、续期或持久化的advance会话。
   * @param event - 触发advance的领域事件，包含 `type`、`captchaUrl`、`newDevicePullQrCodeSig`、`qrcodeUrl` 字段。
   * @returns 包含 `progressMessage`、`stage`、`status` 字段的advance；没有可用结果或提前结束时为 `undefined`。
   */
  advance(
    session: NapcatLoginSessionState,
    event: NapcatLoginStateEvent,
  ): NapcatLoginSessionState {
    if (session.status === 'failure') return session;

    switch (event.type) {
      case 'quick-login-failed':
        return {
          ...session,
          progressMessage: (() => {
            if (session.hasSavedPassword) {
              return NAPCAT_LOGIN_PROGRESS_MESSAGES.quickToPassword;
            }
            return NAPCAT_LOGIN_PROGRESS_MESSAGES.manualQr;
          })(),
          stage: (() => {
            if (session.hasSavedPassword) {
              return 'password-login';
            }
            return 'manual-qr';
          })(),
        };

      case 'password-login-failed':
      case 'manual-qr-required':
        return {
          ...session,
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.manualQr,
          stage: 'manual-qr',
        };

      case 'password-login-captcha-required':
        return {
          ...session,
          challenge: {
            status: 'pending',
            type: 'captcha',
            url: event.captchaUrl,
          },
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.captchaNeeded,
          stage: 'captcha',
        };

      case 'captcha-still-required':
        if (session.challenge?.type === 'captcha') {
          return {
              ...session,
              challenge: {
                ...session.challenge,
                status:
                  (() => {
                    if (session.challenge.status === 'submitted') {
                      return 'submitted';
                    }
                    return 'pending';
                  })(),
              },
              progressMessage:
                (() => {
                  if (session.challenge.status === 'submitted') {
                    return NAPCAT_LOGIN_PROGRESS_MESSAGES.captchaSubmitted;
                  }
                  return NAPCAT_LOGIN_PROGRESS_MESSAGES.captchaNeeded;
                })(),
              stage: 'captcha',
            };
        }
        return session;

      case 'captcha-submitted':
        if (session.challenge?.type === 'captcha') {
          return {
              ...session,
              challenge: {
                ...session.challenge,
                status: 'submitted',
              },
              progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.captchaSubmitted,
              stage: 'captcha',
            };
        }
        return session;

      case 'captcha-new-device-required':
        return {
          ...session,
          challenge: {
            pullQrCodeSig: event.newDevicePullQrCodeSig,
            status: 'qr-pending',
            type: 'new-device',
          },
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.newDeviceNeeded,
          stage: 'new-device',
        };

      case 'new-device-qr-ready':
      case 'new-device-poll-pending':
        return this.updateNewDeviceChallenge(session, {
          qrcodeUrl:
            (() => {
              if (event.type === 'new-device-qr-ready') {
                return event.qrcodeUrl;
              }
              return undefined;
            })(),
          status: 'qr-pending',
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.newDeviceQrPending,
        });

      case 'new-device-scanned':
        return this.updateNewDeviceChallenge(session, {
          status: 'scanned',
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.newDeviceScanned,
        });

      case 'new-device-confirming':
        return this.updateNewDeviceChallenge(session, {
          status: 'confirming',
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.newDeviceConfirming,
        });

      case 'new-device-expired':
        return this.updateNewDeviceChallenge(session, {
          reason: event.reason,
          status: 'expired',
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.newDeviceQrPending,
        });

      case 'new-device-failed':
        return this.updateNewDeviceChallenge(session, {
          reason: event.reason,
          status: 'failed',
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.failed,
        });

      case 'new-device-verified':
        return {
          ...session,
          challenge: undefined,
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.newDeviceVerified,
          stage: 'password-login',
        };

      case 'runtime-cleanup-failed':
        return {
          ...session,
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.cleanupFailed,
          stage: 'cleanup-failed',
          status: 'failure',
        };

      case 'login-success':
        return {
          ...session,
          progressMessage: NAPCAT_LOGIN_PROGRESS_MESSAGES.success,
          selfId: event.selfId,
          stage: 'success',
          status: 'success',
        };

      case 'login-failed':
        return {
          ...session,
          progressMessage:
            event.reason || NAPCAT_LOGIN_PROGRESS_MESSAGES.failed,
          stage: 'failure',
          status: 'failure',
        };
    }
  }

  /**
   * 根据`session`、`patch`更新设备验证挑战。
   * @param session - 待读取、续期或持久化的设备验证挑战会话。
   * @param patch - 用于设备验证挑战的领域对象，包含 `qrcodeUrl`、`reason`、`status`、`progressMessage` 字段。
   * @returns 包含 `challenge`、`progressMessage`、`stage` 字段的设备验证挑战。
   */
  private updateNewDeviceChallenge(
    session: NapcatLoginSessionState,
    patch: {
      progressMessage: string;
      qrcodeUrl?: string;
      reason?: string;
      status: Extract<NapcatLoginChallenge, { type: 'new-device' }>['status'];
    },
  ): NapcatLoginSessionState {
    if (session.challenge?.type !== 'new-device') return session;

    return {
      ...session,
      challenge: {
        ...session.challenge,
        qrcodeUrl: patch.qrcodeUrl || session.challenge.qrcodeUrl,
        reason: patch.reason || session.challenge.reason,
        status: patch.status,
      },
      progressMessage: patch.progressMessage,
      stage: 'new-device',
    };
  }
}
