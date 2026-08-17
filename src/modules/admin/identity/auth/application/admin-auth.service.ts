import {
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { PublicRateLimitService, throwVbenError, ToolsService } from '@/common';
import type { AdminRefreshTokenPayload } from '@/modules/admin/contract/admin.types';
import { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { AdminPasswordHashService } from './admin-password-hash.service';
import { AdminRefreshTokenStateStore } from '@/modules/admin/identity/auth/infrastructure/persistence/admin-refresh-token-state.store';
import { AdminTokenService } from './admin-token.service';

const ACCESS_TOKEN_COOKIE = 'admin_access_token';
const REFRESH_TOKEN_COOKIE = 'jwt';

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
    private readonly tokenService: AdminTokenService,
    private readonly refreshTokenStateStore: AdminRefreshTokenStateStore,
    private readonly toolsService: ToolsService,
    private readonly passwordHashService: AdminPasswordHashService,
    private readonly rateLimitService: PublicRateLimitService,
  ) {}

  /**
   * 根据`username`、`password`处理针对处理登录；先通过 `passwordHashService.verifyPassword` 校验输入边界。
   * @param username - 决定是否启用“username”分支的布尔选项；为空时采用 `!password` 作为兜底。
   * @param password - 决定针对处理登录内容、边界或目标的 `password` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 包含 `accessToken`、`refreshToken`、`user` 字段的针对处理登录。
   */
  async login(username?: string, password?: string) {
    if (!username || !password) {
      throwVbenError(
        'Username and password are required',
        HttpStatus.BAD_REQUEST,
        'BadRequestException',
      );
    }

    const user = await this.findUserByUsernameForLogin(username);
    const passwordMatches = await this.passwordHashService.verifyPassword(
      password,
      user?.password,
    );
    if (!user || user.isDeleted || user.status !== 1 || !passwordMatches) {
      throwVbenError(
        'Username or password is incorrect.',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.rateLimitService.clearSuccessfulLoginUsername(username);
    const refreshSessionId = await this.createRefreshSession();
    delete (user as { password?: string }).password;
    return {
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: this.tokenService.signRefreshToken(user, refreshSessionId),
      user,
    };
  }

  /**
   * 根据`refreshToken`、`response`处理刷新结果；先通过 `tokenService.verifyRefreshToken` 校验输入边界。
   * @param refreshToken - 决定刷新结果内容、边界或目标的 `refreshToken` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 包含 `accessToken`、`refreshToken` 字段的刷新。
   * @throws 当 `refreshTokenStateStore.rotateSession` 或 `getRemainingTokenTtlMs` 调用失败时拒绝当前输入并抛出 `ServiceUnavailableException`。
   */
  async refresh(refreshToken?: string, response?: Response) {
    if (!refreshToken) {
      throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
    }

    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    if (!payload) throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
    await this.rateLimitService.consumeVerifiedTokenSubject(
      'refresh',
      payload.sub,
      response,
    );

    const user = await this.findActiveUserByUsername(payload.username);
    if (!user) throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
    let rotated = false;
    try {
      rotated = await this.refreshTokenStateStore.rotateSession({
        currentTokenTtlMs: this.getRemainingTokenTtlMs(payload),
        nextTokenTtlMs: this.tokenService.getRefreshTokenTtlMs(),
        sessionId: payload.sid,
        tokenId: payload.jti,
      });
    } catch {
      throw new ServiceUnavailableException('认证会话服务暂不可用');
    }
    if (!rotated) {
      throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
    }

    return {
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: this.tokenService.signRefreshToken(user, payload.sid),
    };
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param authHeader - 决定用户内容、边界或目标的 `authHeader` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param req - 用于用户的当前 HTTP 请求；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 用户。
   */
  async currentUser(authHeader?: string, req?: Request) {
    const tokens = [
      this.toolsService.readBearerToken(authHeader),
      this.toolsService.readCookie(req, ACCESS_TOKEN_COOKIE),
    ].filter((token): token is string => !!token);
    const payload = tokens
      .map((token) => this.tokenService.verifyAccessToken(token))
      .find(Boolean);
    if (!payload) {
      throwVbenError('Unauthorized Exception', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.userRepository.findOne({
      relations: ['roles', 'roles.menus'],
      where: {
        id: payload.sub,
        isDeleted: false,
        status: 1,
      },
    });
    if (!user)
      throwVbenError('Unauthorized Exception', HttpStatus.UNAUTHORIZED);
    return user;
  }

  /**
   * 按`req`读取刷新结果令牌；从 `toolsService.readCookie` 读取刷新结果令牌。
   * @param req - 用于刷新结果令牌的当前 HTTP 请求。
   * @returns 刷新结果令牌。
   */
  getRefreshTokenFromRequest(req: Request) {
    return this.toolsService.readCookie(req, REFRESH_TOKEN_COOKIE);
  }

  /**
   * 校验刷新令牌后消费账号级退出限流并撤销对应服务端会话；令牌缺失或无效时直接结束。
   * @param refreshToken - 决定刷新令牌后消费账号级退出限流并撤销对应服务端会话内容、边界或目标的 `refreshToken` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @throws 当 `refreshTokenStateStore.revokeSession` 或 `getRemainingTokenTtlMs` 调用失败时拒绝当前输入并抛出 `ServiceUnavailableException`。
   */
  async logout(refreshToken?: string, response?: Response): Promise<void> {
    if (!refreshToken) return;
    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    if (!payload) return;
    await this.rateLimitService.consumeVerifiedTokenSubject(
      'logout',
      payload.sub,
      response,
    );
    try {
      await this.refreshTokenStateStore.revokeSession(
        payload.sid,
        this.getRemainingTokenTtlMs(payload),
      );
    } catch {
      throw new ServiceUnavailableException('认证会话服务暂不可用');
    }
  }

  /**
   * 根据`res`、`token`更新访问权限令牌Cookie；从 `getTokenCookieOptions` 读取访问权限令牌Cookie。
   * @param res - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   * @param token - 决定访问权限令牌Cookie内容、边界或目标的 `token` 值。
   */
  setAccessTokenCookie(res: Response, token: string) {
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
      ...this.getTokenCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  /**
   * 根据`res`、`token`更新刷新结果令牌Cookie；从 `getTokenCookieOptions` 读取刷新结果令牌Cookie。
   * @param res - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   * @param token - 决定刷新结果令牌Cookie内容、边界或目标的 `token` 值。
   */
  setRefreshTokenCookie(res: Response, token: string) {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      ...this.getTokenCookieOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  /**
   * 在 HTTP 响应上清除刷新令牌 Cookie，并沿用统一的 Cookie 安全属性。
   * @param res - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   */
  clearRefreshTokenCookie(res: Response) {
    this.clearTokenCookie(res, REFRESH_TOKEN_COOKIE);
  }

  /**
   * 在 HTTP 响应上清除访问令牌 Cookie，并沿用统一的 Cookie 安全属性。
   * @param res - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   */
  clearAccessTokenCookie(res: Response) {
    this.clearTokenCookie(res, ACCESS_TOKEN_COOKIE);
  }

  /**
   * 按`username`读取启用状态用户Username；从 `userRepository.findOne` 读取启用状态用户Username。
   * @param username - 决定是否启用“username”分支的布尔选项。
   * @returns 启用状态用户Username。
   */
  private async findActiveUserByUsername(username: string) {
    return this.userRepository.findOne({
      relations: ['roles', 'roles.menus'],
      where: {
        isDeleted: false,
        status: 1,
        username,
      },
    });
  }

  /**
   * 按用户名精确查询登录账号，并显式加载密码、角色与菜单关联；未命中时返回空值。
   * @param username - 决定是否启用“username”分支的布尔选项。
   * @returns 用户UsernameLogin。
   */
  private async findUserByUsernameForLogin(username: string) {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('role.menus', 'menu')
      .where('user.username = :username', { username })
      .getOne();
  }

  /**
   * 按刷新令牌有效期最多尝试两次写入随机会话标识；存储不可用或持续冲突时拒绝登录。
   * @returns 返回已成功写入服务端存储的随机刷新会话标识。
   * @throws 刷新会话存储调用失败，或两次随机会话标识均写入冲突时抛出 `ServiceUnavailableException`。
   */
  private async createRefreshSession() {
    const ttlMs = this.tokenService.getRefreshTokenTtlMs();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const sessionId = this.tokenService.createRefreshSessionId();
        if (await this.refreshTokenStateStore.createSession(sessionId, ttlMs)) {
          return sessionId;
        }
      }
    } catch {
      throw new ServiceUnavailableException('认证会话服务暂不可用');
    }
    throw new ServiceUnavailableException('认证会话服务暂不可用');
  }

  /**
   * 用令牌过期时间减去当前时间得到剩余毫秒数，并把存储有效期下限钳制为 1 毫秒。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `exp` 字段。
   * @returns Remaining令牌有效期Ms。
   */
  private getRemainingTokenTtlMs(payload: AdminRefreshTokenPayload) {
    return Math.max(1, payload.exp * 1000 - Date.now());
  }

  /**
   * 按当前运行态读取令牌Cookie选项。
   * @returns 包含 `httpOnly`、`path`、`sameSite`、`secure` 字段的令牌Cookie选项。
   */
  private getTokenCookieOptions() {
    const secure =
      process.env.NODE_ENV === 'production' ||
      process.env.ADMIN_COOKIE_SECURE === 'true';
    return {
      httpOnly: true,
      path: '/',
      sameSite: 'lax' as const,
      secure,
    };
  }

  /**
   * 按`res`、`cookieName`移除令牌Cookie；从 `getTokenCookieOptions` 读取令牌Cookie。
   * @param res - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   * @param cookieName - 决定令牌Cookie内容、边界或目标的 `cookieName` 值。
   */
  private clearTokenCookie(res: Response, cookieName: string) {
    const options = this.getTokenCookieOptions();
    res.clearCookie(cookieName, options);
    // 兼容旧版本未显式指定 path 时由浏览器按接口路径生成的 cookie。
    res.clearCookie(cookieName, { ...options, path: '/api/auth' });
    res.clearCookie(cookieName, { ...options, path: '/auth' });
  }
}
