import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { BotLoginScanSession } from '@/modules/bot-adapter/core/contract/bot.types';
import {
  NapcatLoginChallengeEntity,
  type NapcatLoginChallengeType,
} from './napcat-login-challenge.entity';
import { NapcatLoginSession } from './napcat-login-session.entity';
import {
  NapcatRuntimeCleanup,
  type NapcatRuntimeCleanupStatus,
} from './napcat-runtime-cleanup.entity';

type NapcatLoginStoreCache = Record<string, BotLoginScanSession>;

@Injectable()
export class NapcatLoginStateStoreService {
  private readonly logger = new Logger(NapcatLoginStateStoreService.name);
  private readonly cache: NapcatLoginStoreCache = {};
  private readonly pendingSessionWrites: Record<
    string,
    Promise<void> | undefined
  > = {};

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
   * 从内存缓存读取未过期的登录会话；命中已过期记录时删除并返回空值。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 缓存会话。
   */
  getCached(sessionId: string) {
    return this.cache[sessionId];
  }

  /**
   * 根据 `!!this.cache[sessionId]` 判定输入是否满足条件。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 满足`has` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  has(sessionId: string) {
    return !!this.cache[sessionId];
  }

  /**
   * 逐个删除内存中的全部 NapCat 登录会话，使状态缓存回到空集合。
   */
  clear() {
    Object.keys(this.cache).forEach((sessionId) => {
      delete this.cache[sessionId];
    });
  }

  /**
   * 优先返回内存中的 NapCat 登录会话；缓存未命中时从数据库恢复并回填缓存，仍不存在则返回 `undefined`。
   * @param sessionId - 用于精确定位会话的标识。
   * @returns 优先返回内存中的 NapCat 登录会话；没有可用结果或提前结束时为 `undefined`。
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
   * 根据`session`更新`set` 对应结果。
   * @param session - 待读取、续期或持久化的`set` 对应结果会话。
   */
  set(session: BotLoginScanSession) {
    this.cache[session.id] = session;
    this.enqueueSessionWrite(session.id, () => this.persistSession(session));
  }

  /**
   * 删除指定 NapCat 登录会话的内存缓存，并串行排队将持久化状态标记为已完成。
   * @param sessionId - 用于精确定位会话的标识。
   */
  delete(sessionId: string) {
    delete this.cache[sessionId];
    this.enqueueSessionWrite(sessionId, () => this.markCompleted(sessionId));
  }

  /**
   * 按缓存枚举顺序向回调传入每个 NapCat 登录会话及其标识。
   * @param iterator - 决定按缓存枚举顺序向回调传入每个 NapCat 登录会话及其标识内容、边界或目标的 `iterator` 值。
   */
  forEach(
    iterator: (session: BotLoginScanSession, sessionId: string) => void,
  ) {
    Object.entries(this.cache).forEach(([sessionId, session]) =>
      iterator(session, sessionId),
    );
  }

  /**
   * 根据`session`处理记录验证码验证挑战。
   * @param session - 待读取、续期或持久化的记录验证码验证挑战会话。
   */
  recordCaptchaChallenge(session: BotLoginScanSession) {
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
   * 根据`session`处理记录设备验证挑战。
   * @param session - 待读取、续期或持久化的记录设备验证挑战会话。
   */
  recordNewDeviceChallenge(session: BotLoginScanSession) {
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
   * 根据`session`、`input`处理记录运行态Cleanup；把变更持久化到当前存储（`runtimeCleanupRepository.create`）。
   * @param session - 待读取、续期或持久化的记录运行态Cleanup会话。
   * @param input - 用于记录运行态Cleanup的结构化输入，包含 `cleanupType`、`errorMessage`、`status` 字段。
   */
  recordRuntimeCleanup(
    session: BotLoginScanSession,
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
   * 通过 `filter` 筛选匹配数据，在 `sessionId` 成立时直接结束。
   * @param sessionId - 用于精确定位会话的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
   * 按会话标识串行化异步写入，避免同一会话的持久化操作互相覆盖。
   * @param sessionId - 用于精确定位会话的标识。
   * @param writer - 决定enqueue会话内容、边界或目标的 `writer` 值。
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
   * 根据`session`更新persist会话；把变更持久化到当前存储（`loginSessionRepository.update`）。
   * @param session - 待读取、续期或持久化的persist会话。
   * @throws 当 `!this.isDuplicateSessionKeyError(err)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async persistSession(session: BotLoginScanSession) {
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
   * 将输入收敛并投影为会话持久化快照。
   * @param session - 待读取、续期或持久化的会话持久化快照会话。
   * @returns 包含 `accountId`、`completedAt`、`expiresAt`、`loginStage`、`progressMessage` 字段的会话持久化快照；无法解析或未命中时为 `null`。
   */
  private toSessionPersistenceSnapshot(
    session: BotLoginScanSession,
  ): Partial<NapcatLoginSession> {
    return {
      accountId: session.accountId || null,
      completedAt:
        (() => {
          if (session.status === 'pending') {
            return null;
          }
          return (new Date() as NapcatLoginSession['completedAt']);
        })(),
      expiresAt: new Date(session.expiresAt) as NapcatLoginSession['expiresAt'],
      loginStage: this.pickLoginStage(session),
      progressMessage:
        session.errorMessage || this.pickProgressMessage(session),
      sessionPayload: session,
      status: session.status,
    };
  }

  /**
   * 根据`err`与当前约束判定重复会话键错误。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足重复会话键错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isDuplicateSessionKeyError(err: unknown) {
    const detail =
      (() => {
        if (err && typeof err === 'object') {
          return (err as { code?: string; errno?: number; message?: string });
        }
        return undefined;
      })();
    const message = detail?.message || '';
    return (
      detail?.code === 'ER_DUP_ENTRY' ||
      detail?.errno === 1062 ||
      message.includes('uk_napcat_login_session_key') ||
      message.includes('Duplicate entry')
    );
  }

  /**
   * 根据`sessionId`处理Completed；当 `current.status === 'pending'` 成立时直接结束且不产生返回值。
   * @param sessionId - 用于精确定位会话的标识。
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
          sessionPayload: (() => {
            if (current.sessionPayload) {
              return {
                ...current.sessionPayload,
                errorMessage: '扫码会话已取消',
                status: 'error',
              };
            }
            return current.sessionPayload;
          })(),
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
   * 将持久化登录会话恢复到内存缓存，并重建有效期与挑战索引。
   * @param session - 待读取、续期或持久化的hydratePersisted会话。
   * @returns hydratePersisted会话。
   */
  private async hydratePersistedSession(session: BotLoginScanSession) {
    const hydratedSession = { ...session };

    await this.hydrateCaptchaChallenge(hydratedSession);
    await this.hydrateNewDeviceChallenge(hydratedSession);
    await this.hydrateRuntimeCleanup(hydratedSession);

    return hydratedSession;
  }

  /**
   * 根据`session`处理hydrate验证码验证挑战；从 `findChallenge` 读取hydrate验证码验证挑战。
   * @param session - 待读取、续期或持久化的hydrate验证码验证挑战会话。
   */
  private async hydrateCaptchaChallenge(session: BotLoginScanSession) {
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
   * 根据`session`处理hydrate设备验证挑战；从 `findChallenge` 读取hydrate设备验证挑战。
   * @param session - 待读取、续期或持久化的hydrate设备验证挑战会话。
   */
  private async hydrateNewDeviceChallenge(session: BotLoginScanSession) {
    const challenge = await this.findChallenge(session.id, 'new-device');
    if (!challenge || this.isResolvedChallenge(challenge.status)) return;

    const payload = this.toChallengePayload(challenge.challengePayload);
    session.newDeviceStatus =
      challenge.status as BotLoginScanSession['newDeviceStatus'];
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
      if (typeof payload.newDeviceQrcode === 'string') {
        session.newDeviceQrcode = payload.newDeviceQrcode;
      } else {
        session.newDeviceQrcode = challenge.challengeUrl || undefined;
      }
    }
    session.errorMessage = session.errorMessage || '需要新设备验证二维码';
  }

  /**
   * 根据`session`处理hydrate运行态Cleanup；从 `runtimeCleanupRepository.findOne` 读取hydrate运行态Cleanup。
   * @param session - 待读取、续期或持久化的hydrate运行态Cleanup会话。
   */
  private async hydrateRuntimeCleanup(session: BotLoginScanSession) {
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
   * 按`sessionId`、`challengeType`读取验证挑战；从 `loginChallengeRepository.findOne` 读取验证挑战。
   * @param sessionId - 用于精确定位会话的标识。
   * @param challengeType - 决定验证挑战内容、边界或目标的 `challengeType` 值。
   * @returns 验证挑战；无法解析或未命中时为 `null`。
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
   * 将`payload`转换为验证挑战载荷；当 `payload && typeof payload === 'object'` 成立时返回 `(payload as Record<string, unknown>)`。
   * @param payload - 待按当前协议校验并路由的事件载荷。
   * @returns 验证挑战载荷。
   */
  private toChallengePayload(payload: unknown) {
    if (payload && typeof payload === 'object') {
      return (payload as Record<string, unknown>);
    }
    return {};
  }

  /**
   * 根据`input`更新验证挑战；把变更持久化到当前存储（`loginChallengeRepository.create`）。
   * @param input - 用于验证挑战的结构化输入，包含 `challengePayload`、`challengeType`、`challengeUrl`、`status` 字段。
   */
  private async saveChallenge(input: {
    challengePayload: null | Record<string, unknown>;
    challengeType: NapcatLoginChallengeType;
    challengeUrl: null | string;
    session: BotLoginScanSession;
    status: string;
  }) {
    if (!this.loginChallengeRepository) return;
    const entity = this.loginChallengeRepository.create({
      challengePayload: input.challengePayload,
      challengeType: input.challengeType,
      challengeUrl: input.challengeUrl,
      resolvedAt: (() => {
        if (this.isResolvedChallenge(input.status)) {
          return (new Date() as NapcatLoginChallengeEntity['resolvedAt']);
        }
        return null;
      })(),
      sessionId: input.session.id,
      status: input.status,
    });
    await this.loginChallengeRepository.save(entity);
  }

  /**
   * 通过 `logger.warn` 记录带上下文的运行异常或诊断信息。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   */
  private warnPersistenceError(message: string, err: unknown) {
    const detail =
      (() => {
        if (err instanceof Error) {
          return err.message;
        }
        if (typeof err === 'string') {
          return err;
        }
        return JSON.stringify(err);
      })();
    this.logger.warn(`${message}: ${detail || 'unknown error'}`);
  }

  /**
   * 仅将 `failed`、`expired` 和 `verified` 识别为已结束的新设备验证状态。
   * @param status - 决定Resolved验证挑战内容、边界或目标的 `status` 值。
   * @returns 满足Resolved验证挑战约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isResolvedChallenge(status: string) {
    return ['failed', 'expired', 'verified'].includes(status);
  }

  /**
   * 从`session`筛选Login阶段，并保持保留项的原有顺序与键名。
   * @param session - 待读取、续期或持久化的Login阶段会话。
   * @returns 当前状态对应的Login阶段，取值为 `'new-device'`、`'captcha'`、`'password'`、`'quick'`、`'manual-qr'`。
   */
  private pickLoginStage(session: BotLoginScanSession) {
    if (session.newDeviceStatus) return 'new-device';
    if (session.captchaUrl) return 'captcha';
    if (session.passwordMd5) return 'password';
    if (session.preparingRelogin) return 'quick';
    if (session.qrcode) return 'manual-qr';
    return session.status;
  }

  /**
   * 从`session`筛选Progress消息，并保持保留项的原有顺序与键名。
   * @param session - 待读取、续期或持久化的Progress消息会话。
   * @returns 表示Progress消息的固定文本 `'登录处理中'`。
   */
  private pickProgressMessage(session: BotLoginScanSession) {
    if (session.status === 'success') return '登录成功';
    if (session.status === 'error') return '登录失败';
    if (session.status === 'expired') return '扫码会话已过期';
    if (session.newDeviceStatus) return '需要新设备验证二维码';
    if (session.captchaUrl) return '需要验证码';
    if (session.qrcode) return '正在生成手动二维码';
    return '登录处理中';
  }
}
