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
  private readonly pendingSessionWrites: Record<
    string,
    Promise<void> | undefined
  > = {};

  /**
   * 初始化 NapcatLoginStateStoreService 实例。
   * @param loginSessionRepository - NapCat仓库依赖；影响 constructor 的返回值。
   * @param loginChallengeRepository - NapCat仓库依赖；影响 constructor 的返回值。
   * @param runtimeCleanupRepository - NapCat仓库依赖；影响 constructor 的返回值。
   */
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

  /**
   * 查询 NapCat 登录运行态数据。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  getCached(sessionId: string) {
    return this.cache[sessionId];
  }

  /**
   * 判断业务数据。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  has(sessionId: string) {
    return !!this.cache[sessionId];
  }

  /**
   * 清理业务数据。
   */
  clear() {
    Object.keys(this.cache).forEach((sessionId) => {
      delete this.cache[sessionId];
    });
  }

  /**
   * 获取业务数据。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
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

  /**
   * 设置业务数据。
   * @param session - session 输入；使用 `id` 字段生成结果。
   */
  set(session: QqbotLoginScanSession) {
    this.cache[session.id] = session;
    this.enqueueSessionWrite(session.id, () => this.persistSession(session));
  }

  /**
   * 删除数据。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  delete(sessionId: string) {
    delete this.cache[sessionId];
    this.enqueueSessionWrite(sessionId, () => this.markCompleted(sessionId));
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param iterator - iterator 输入；驱动 `Object.entries()` 的 NapCat步骤。
   */
  forEach(
    iterator: (session: QqbotLoginScanSession, sessionId: string) => void,
  ) {
    Object.entries(this.cache).forEach(([sessionId, session]) =>
      iterator(session, sessionId),
    );
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `captchaUrl`、`expectedSelfId`、`passwordMd5` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `newDeviceStatus`、`deviceVerifyUrl`、`newDeviceBytesToken`、`newDevicePullQrCodeSig` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `id` 字段生成结果。
   * @param input - input 输入；使用 `cleanupType`、`errorMessage`、`status` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
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

  /**
   * 投递 NapCat 登录运行态消息或任务。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   * @param writer - writer 输入；驱动 `previous.catch()` 的 NapCat步骤。
   */
  private enqueueSessionWrite(sessionId: string, writer: () => Promise<void>) {
    const previous = this.pendingSessionWrites[sessionId] || Promise.resolve();
    const queued = previous.catch(() => undefined).then(writer);
    const tracked = queued.finally(() => {
      if (this.pendingSessionWrites[sessionId] === tracked) {
        delete this.pendingSessionWrites[sessionId];
      }
    });
    this.pendingSessionWrites[sessionId] = tracked;
    void tracked.catch((err) =>
      this.warnPersistenceError('登录会话持久化失败', err),
    );
  }

  /**
   * 保存 NapCat 登录运行态数据。
   * @param session - session 输入；使用 `id`、`accountId`、`status`、`expiresAt` 字段生成结果。
   */
  private async persistSession(session: QqbotLoginScanSession) {
    if (!this.loginSessionRepository) return;
    const snapshot = this.toSessionPersistenceSnapshot(session);
    const updateResult = await this.loginSessionRepository.update(
      { sessionKey: session.id },
      snapshot as any,
    );
    if (updateResult.affected) return;

    try {
      const entity = this.loginSessionRepository.create({
        ...snapshot,
        sessionKey: session.id,
      });
      await this.loginSessionRepository.save(entity);
    } catch (err) {
      if (!this.isDuplicateSessionKeyError(err)) throw err;
      await this.loginSessionRepository.update(
        { sessionKey: session.id },
        snapshot as any,
      );
    }
  }

  /**
   * Builds the database snapshot for a scan session without carrying stale entity fields from an older row.
   * @param session - Runtime scan session whose status, QR, expiry and challenge markers are the source of truth.
   * @returns Partial entity used for update-first persistence by session key.
   */
  private toSessionPersistenceSnapshot(
    session: QqbotLoginScanSession,
  ): Partial<NapcatLoginSession> {
    return {
      accountId: session.accountId || null,
      completedAt:
        session.status === 'pending'
          ? null
          : (new Date() as NapcatLoginSession['completedAt']),
      expiresAt: new Date(session.expiresAt) as NapcatLoginSession['expiresAt'],
      loginStage: this.pickLoginStage(session),
      progressMessage:
        session.errorMessage || this.pickProgressMessage(session),
      sessionPayload: session,
      status: session.status,
    };
  }

  /**
   * Detects the session-key duplicate race that can happen when two workers insert the same scan session concurrently.
   * @param err - Database error raised by TypeORM save; MySQL duplicate-key metadata may appear as code, errno or message text.
   * @returns True when retrying as an update by sessionKey is safe.
   */
  private isDuplicateSessionKeyError(err: unknown) {
    const detail =
      err && typeof err === 'object'
        ? (err as { code?: string; errno?: number; message?: string })
        : undefined;
    const message = detail?.message || '';
    return (
      detail?.code === 'ER_DUP_ENTRY' ||
      detail?.errno === 1062 ||
      message.includes('uk_napcat_login_session_key') ||
      message.includes('Duplicate entry')
    );
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   */
  private async markCompleted(sessionId: string) {
    if (!this.loginSessionRepository) return;
    const current = await this.loginSessionRepository.findOne({
      where: { sessionKey: sessionId },
    });
    if (!current) return;

    const completedAt = new Date() as NapcatLoginSession['completedAt'];
    if (current.status === 'pending') {
      await this.loginSessionRepository.update(
        { sessionKey: sessionId },
        {
          completedAt,
          loginStage: 'cancelled',
          progressMessage: '扫码会话已取消',
          sessionPayload: current.sessionPayload
            ? {
                ...current.sessionPayload,
                errorMessage: '扫码会话已取消',
                status: 'error',
              }
            : current.sessionPayload,
          status: 'error',
        },
      );
      return;
    }

    await this.loginSessionRepository.update(
      { sessionKey: sessionId },
      {
        completedAt,
      },
    );
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；影响 hydratePersistedSession 的返回值。
   */
  private async hydratePersistedSession(session: QqbotLoginScanSession) {
    const hydratedSession = { ...session };

    await this.hydrateCaptchaChallenge(hydratedSession);
    await this.hydrateNewDeviceChallenge(hydratedSession);
    await this.hydrateRuntimeCleanup(hydratedSession);

    return hydratedSession;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `id`、`captchaUrl`、`expectedSelfId`、`errorMessage` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `id`、`newDeviceStatus`、`deviceVerifyUrl`、`newDevicePullQrCodeSig` 字段生成结果。
   */
  private async hydrateNewDeviceChallenge(session: QqbotLoginScanSession) {
    const challenge = await this.findChallenge(session.id, 'new-device');
    if (!challenge || this.isResolvedChallenge(challenge.status)) return;

    const payload = this.toChallengePayload(challenge.challengePayload);
    session.newDeviceStatus =
      challenge.status as QqbotLoginScanSession['newDeviceStatus'];
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `id`、`status`、`captchaUrl`、`errorMessage` 字段生成结果。
   */
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

  /**
   * 查询 NapCat 登录运行态数据。
   * @param sessionId - NapCat ID；定位本次读取、更新、删除或关联的NapCat。
   * @param challengeType - challengeType 输入；限定 NapCat查询范围。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param payload - payload 输入；影响 toChallengePayload 的返回值。
   */
  private toChallengePayload(payload: unknown) {
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  }

  /**
   * 保存Challenge。
   * @param input - input 输入；使用 `challengePayload`、`challengeType`、`challengeUrl`、`status` 字段生成结果。
   */
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

  /**
   * 执行 NapCat 登录运行态流程。
   * @param message - message 输入；影响 warnPersistenceError 的返回值。
   * @param err - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   */
  private warnPersistenceError(message: string, err: unknown) {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : JSON.stringify(err);
    this.logger.warn(`${message}: ${detail || 'unknown error'}`);
  }

  /**
   * 判断 NapCat 登录运行态条件。
   * @param status - NapCat列表；驱动 `includes()` 的 NapCat步骤。
   */
  private isResolvedChallenge(status: string) {
    return ['failed', 'expired', 'verified'].includes(status);
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `newDeviceStatus`、`captchaUrl`、`passwordMd5`、`preparingRelogin` 字段生成结果。
   */
  private pickLoginStage(session: QqbotLoginScanSession) {
    if (session.newDeviceStatus) return 'new-device';
    if (session.captchaUrl) return 'captcha';
    if (session.passwordMd5) return 'password';
    if (session.preparingRelogin) return 'quick';
    if (session.qrcode) return 'manual-qr';
    return session.status;
  }

  /**
   * 执行 NapCat 登录运行态流程。
   * @param session - session 输入；使用 `status`、`newDeviceStatus`、`captchaUrl`、`qrcode` 字段生成结果。
   */
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
