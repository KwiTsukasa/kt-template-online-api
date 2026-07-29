import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { PublicRateLimitService, throwVbenError, ToolsService } from '@/common';
import { AdminUser } from '../user/admin-user.entity';
import { AdminPasswordHashService } from './admin-password-hash.service';
import { AdminTokenService } from './admin-token.service';

const ACCESS_TOKEN_COOKIE = 'admin_access_token';
const REFRESH_TOKEN_COOKIE = 'jwt';

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
    private readonly tokenService: AdminTokenService,
    private readonly toolsService: ToolsService,
    private readonly passwordHashService: AdminPasswordHashService,
    private readonly rateLimitService: PublicRateLimitService,
  ) {}

  /**
   * 处理登录。
   * @param username - username 输入；驱动 Admin 登录用户查询。
   * @param password - password 输入；驱动 `throwVbenError()` 的 Admin步骤。
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
    delete (user as { password?: string }).password;
    return {
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: this.tokenService.signRefreshToken(user),
      user,
    };
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param refreshToken - 协议 token；驱动 `tokenService.verifyRefreshToken()`、`tokenService.signAccessToken()` 的 Admin步骤。
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

    return {
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: this.tokenService.signRefreshToken(user),
    };
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param authHeader - authHeader 输入；驱动 `toolsService.readBearerToken()` 的 Admin步骤。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
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
   * 查询 Admin 身份权限数据。
   * @param req - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   */
  getRefreshTokenFromRequest(req: Request) {
    return this.toolsService.readCookie(req, REFRESH_TOKEN_COOKIE);
  }

  async consumeLogoutSubject(
    refreshToken?: string,
    response?: Response,
  ): Promise<void> {
    if (!refreshToken) return;
    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    if (!payload) return;
    await this.rateLimitService.consumeVerifiedTokenSubject(
      'logout',
      payload.sub,
      response,
    );
  }

  /**
   * 设置Access Token Cookie。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param token - 协议 token；驱动 `res.cookie()` 的 Admin步骤。
   */
  setAccessTokenCookie(res: Response, token: string) {
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
      ...this.getTokenCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  /**
   * 设置Refresh Token Cookie。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param token - 协议 token；驱动 `res.cookie()` 的 Admin步骤。
   */
  setRefreshTokenCookie(res: Response, token: string) {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      ...this.getTokenCookieOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  /**
   * 清理Refresh Token Cookie。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  clearRefreshTokenCookie(res: Response) {
    this.clearTokenCookie(res, REFRESH_TOKEN_COOKIE);
  }

  /**
   * 清理Access Token Cookie。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  clearAccessTokenCookie(res: Response) {
    this.clearTokenCookie(res, ACCESS_TOKEN_COOKIE);
  }

  /**
   * 查询 Admin 身份权限数据。
   * @param username - username 输入；限定 Admin查询范围。
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
   * 查询 Admin 身份权限数据。
   */
  private getTokenCookieOptions() {
    const secure = process.env.ADMIN_COOKIE_SECURE === 'true';
    return {
      httpOnly: true,
      path: '/',
      sameSite: secure ? ('none' as const) : ('lax' as const),
      secure,
    };
  }

  /**
   * 清理Token Cookie。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param cookieName - cookieName 输入；驱动 `res.clearCookie()` 的 Admin步骤。
   */
  private clearTokenCookie(res: Response, cookieName: string) {
    const options = this.getTokenCookieOptions();
    res.clearCookie(cookieName, options);
    // 兼容旧版本未显式指定 path 时由浏览器按接口路径生成的 cookie。
    res.clearCookie(cookieName, { ...options, path: '/api/auth' });
    res.clearCookie(cookieName, { ...options, path: '/auth' });
  }
}
