import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QqbotLoginScanSession } from '@/modules/qqbot/core/contract/qqbot.types';
import {
  NapcatLoginChallengeEntity,
  type NapcatLoginChallengeType,
} from './napcat-login-challenge.entity';
import { NapcatLoginSession } from './napcat-login-session.entity';
import {
  NapcatRuntimeCleanup,
  type NapcatRuntimeCleanupStatus,
} from './napcat-runtime-cleanup.entity';

type NapcatLoginStoreCache = Record<string, QqbotLoginScanSession>;

@Injectable()
export class NapcatLoginStateStoreService {
  private readonly logger = new Logger(NapcatLoginStateStoreService.name);
  private readonly cache: NapcatLoginStoreCache = {};
  private readonly pendingSessionWrites: Record<string, Promise<void> | undefined> =
    {};

  constructor(
    @Optional()
    @InjectRepository(NapcatLoginSession)
    private readonly loginSessionRepository?: Repository<NapcatLoginSession>,
    @Optional()
    @InjectRepository(NapcatLoginChallengeEntity)
    private readonly loginChallengeRepository?: Repository<NapcatLoginChallengeEntity>,
    @Optional()
    @InjectRepository(NapcatRuntimeCleanup)
    private readonly runtimeCleanupRepository?: Repository<NapcatRuntimeCleanup>,
  ) {}

  getCached(sessionId: string) {
    return this.cache[sessionId];
  }

  has(sessionId: string) {
    return !!this.cache[sessionId];
  }

  clear() {
    Object.keys(this.cache).forEach((sessionId) => {
      delete this.cache[sessionId];
    });
  }

  async get(sessionId: string) {
    const cached = this.getCached(sessionId);
    if (cached) return cached;
    if (!this.loginSessionRepository) return undefined;

    const persisted = await this.loginSessionRepository.findOne({
      where: { sessionKey: sessionId },
    });
    const session = persisted?.sessionPayload;
    if (!session) return undefined;

    const hydratedSession = await this.hydratePersistedSession(session);
    this.cache[hydratedSession.id] = hydratedSession;
    return hydratedSession;
  }

  set(session: QqbotLoginScanSession) {
    this.cache[session.id] = session;
    this.enqueueSessionWrite(session.id, () => this.persistSession(session));
  }

  delete(sessionId: string) {
    delete this.cache[sessionId];
    this.enqueueSessionWrite(sessionId, () => this.markCompleted(sessionId));
  }

  forEach(
    iterator: (session: QqbotLoginScanSession, sessionId: string) => void,
  ) {
    Object.entries(this.cache).forEach(([sessionId, session]) =>
      iterator(session, sessionId),
    );
  }

  recordCaptchaChallenge(session: QqbotLoginScanSession) {
    if (!session.captchaUrl) return;
    void this.saveChallenge({
      challengePayload: {
        expectedSelfId: session.expectedSelfId,
        passwordMd5Present: !!session.passwordMd5,
      },
      challengeType: 'captcha',
      challengeUrl: session.captchaUrl,
      session,
      status: 'pending',
    }).catch((err) =>
      this.warnPersistenceError('登录验证码 challenge 持久化失败', err),
    );
  }

  recordNewDeviceChallenge(session: QqbotLoginScanSession) {
    if (!session.newDeviceStatus) return;
    void this.saveChallenge({
      challengePayload: {
        deviceVerifyUrl: session.deviceVerifyUrl,
        newDeviceBytesToken: session.newDeviceBytesToken,
        newDevicePullQrCodeSig: session.newDevicePullQrCodeSig,
        newDeviceQrcode: session.newDeviceQrcode,
      },
      challengeType: 'new-device',
      challengeUrl: session.deviceVerifyUrl || session.newDeviceQrcode || null,
      session,
      status: session.newDeviceStatus,
    }).catch((err) =>
      this.warnPersistenceError('新设备 challenge 持久化失败', err),
    );
  }

  recordRuntimeCleanup(
    session: QqbotLoginScanSession,
    input: {
      cleanupType: string;
      errorMessage?: string;
      status: NapcatRuntimeCleanupStatus;
    },
  ) {
    if (!this.runtimeCleanupRepository) return;
    const cleanup = this.runtimeCleanupRepository.create({
      cleanupType: input.cleanupType,
      errorMessage: input.errorMessage || null,
      sessionId: session.id,
      status: input.status,
    });
    void this.runtimeCleanupRepository
      .save(cleanup)
      .catch((err) =>
        this.warnPersistenceError('运行态清理记录持久化失败', err),
      );
  }

  async flushSessionWrites(sessionId?: string) {
    if (sessionId) {
      await this.pendingSessionWrites[sessionId];
      return;
    }
    await Promise.all(
      Object.values(this.pendingSessionWrites).filter(
        (write): write is Promise<void> => !!write,
      ),
    );
  }

  private enqueueSessionWrite(sessionId: string, writer: () => Promise<void>) {
    const previous = this.pendingSessionWrites[sessionId] || Promise.resolve();
    const queued = previous.catch(() => undefined).then(writer);
    const tracked = queued.finally(() => {
      if (this.pendingSessionWrites[sessionId] === tracked) {
        delete this.pendingSessionWrites[sessionId];
      }
    });
    this.pendingSessionWrites[sessionId] = tracked;
    void tracked.catch(() => undefined);
  }

  private async persistSession(session: QqbotLoginScanSession) {
    if (!this.loginSessionRepository) return;
    const current = await this.loginSessionRepository.findOne({
      where: { sessionKey: session.id },
    });
    const entity = this.loginSessionRepository.create({
      ...(current || {}),
      accountId: session.accountId || null,
      completedAt:
        session.status === 'pending'
          ? null
          : (new Date() as NapcatLoginSession['completedAt']),
      expiresAt: new Date(session.expiresAt) as NapcatLoginSession['expiresAt'],
      loginStage: this.pickLoginStage(session),
      progressMessage: session.errorMessage || this.pickProgressMessage(session),
      sessionKey: session.id,
      sessionPayload: session,
      status: session.status,
    });
    await this.loginSessionRepository.save(entity);
  }

  private async markCompleted(sessionId: string) {
    if (!this.loginSessionRepository) return;
    await this.loginSessionRepository.update(
      { sessionKey: sessionId },
      {
        completedAt: new Date() as NapcatLoginSession['completedAt'],
      },
    );
  }

  private async hydratePersistedSession(session: QqbotLoginScanSession) {
    const hydratedSession = { ...session };

    await this.hydrateCaptchaChallenge(hydratedSession);
    await this.hydrateNewDeviceChallenge(hydratedSession);
    await this.hydrateRuntimeCleanup(hydratedSession);

    return hydratedSession;
  }

  private async hydrateCaptchaChallenge(session: QqbotLoginScanSession) {
    const challenge = await this.findChallenge(session.id, 'captcha');
    if (!challenge || challenge.status !== 'pending') return;

    const payload = this.toChallengePayload(challenge.challengePayload);
    if (!session.captchaUrl && challenge.challengeUrl) {
      session.captchaUrl = challenge.challengeUrl;
    }
    if (!session.expectedSelfId && typeof payload.expectedSelfId === 'string') {
      session.expectedSelfId = payload.expectedSelfId;
    }
    session.errorMessage = session.errorMessage || '需要验证码';
  }

  private async hydrateNewDeviceChallenge(session: QqbotLoginScanSession) {
    const challenge = await this.findChallenge(session.id, 'new-device');
    if (!challenge || this.isResolvedChallenge(challenge.status)) return;

    const payload = this.toChallengePayload(challenge.challengePayload);
    session.newDeviceStatus = challenge.status as QqbotLoginScanSession['newDeviceStatus'];
    if (
      !session.deviceVerifyUrl &&
      typeof payload.deviceVerifyUrl === 'string'
    ) {
      session.deviceVerifyUrl = payload.deviceVerifyUrl;
    }
    if (
      !session.newDevicePullQrCodeSig &&
      payload.newDevicePullQrCodeSig !== undefined &&
      payload.newDevicePullQrCodeSig !== null
    ) {
      session.newDevicePullQrCodeSig = payload.newDevicePullQrCodeSig;
    }
    if (
      !session.newDeviceBytesToken &&
      typeof payload.newDeviceBytesToken === 'string'
    ) {
      session.newDeviceBytesToken = payload.newDeviceBytesToken;
    }
    if (!session.newDeviceQrcode) {
      session.newDeviceQrcode =
        typeof payload.newDeviceQrcode === 'string'
          ? payload.newDeviceQrcode
          : challenge.challengeUrl || undefined;
    }
    session.errorMessage = session.errorMessage || '需要新设备验证二维码';
  }

  private async hydrateRuntimeCleanup(session: QqbotLoginScanSession) {
    if (!this.runtimeCleanupRepository) return;
    const cleanup = await this.runtimeCleanupRepository.findOne({
      order: { createTime: 'DESC' },
      where: {
        cleanupType: 'password-login-env',
        sessionId: session.id,
        status: 'failed',
      },
    } as any);
    if (!cleanup) return;

    session.status = 'error';
    session.captchaUrl = undefined;
    session.errorMessage =
      cleanup.errorMessage || session.errorMessage || '运行态密码清理失败';
    session.passwordMd5 = undefined;
    session.preparingRelogin = false;
  }

  private async findChallenge(
    sessionId: string,
    challengeType: NapcatLoginChallengeType,
  ) {
    if (!this.loginChallengeRepository) return null;
    return this.loginChallengeRepository.findOne({
      order: { createTime: 'DESC' },
      where: {
        challengeType,
        sessionId,
      },
    } as any);
  }

  private toChallengePayload(payload: unknown) {
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  }

  private async saveChallenge(input: {
    challengePayload: null | Record<string, unknown>;
    challengeType: NapcatLoginChallengeType;
    challengeUrl: null | string;
    session: QqbotLoginScanSession;
    status: string;
  }) {
    if (!this.loginChallengeRepository) return;
    const entity = this.loginChallengeRepository.create({
      challengePayload: input.challengePayload,
      challengeType: input.challengeType,
      challengeUrl: input.challengeUrl,
      resolvedAt: this.isResolvedChallenge(input.status)
        ? (new Date() as NapcatLoginChallengeEntity['resolvedAt'])
        : null,
      sessionId: input.session.id,
      status: input.status,
    });
    await this.loginChallengeRepository.save(entity);
  }

  private warnPersistenceError(message: string, err: unknown) {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : JSON.stringify(err);
    this.logger.warn(`${message}: ${detail || 'unknown error'}`);
  }

  private isResolvedChallenge(status: string) {
    return ['failed', 'expired', 'verified'].includes(status);
  }

  private pickLoginStage(session: QqbotLoginScanSession) {
    if (session.newDeviceStatus) return 'new-device';
    if (session.captchaUrl) return 'captcha';
    if (session.passwordMd5) return 'password';
    if (session.preparingRelogin) return 'quick';
    if (session.qrcode) return 'manual-qr';
    return session.status;
  }

  private pickProgressMessage(session: QqbotLoginScanSession) {
    if (session.status === 'success') return '登录成功';
    if (session.status === 'error') return '登录失败';
    if (session.status === 'expired') return '扫码会话已过期';
    if (session.newDeviceStatus) return '需要新设备验证二维码';
    if (session.captchaUrl) return '需要验证码';
    if (session.qrcode) return '正在生成手动二维码';
    return '登录处理中';
  }
}
