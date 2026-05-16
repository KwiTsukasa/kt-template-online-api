import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { AdminUser } from '../user/admin-user.entity';
import { AdminTokenService } from './admin-token.service';

const ACCESS_TOKEN_COOKIE = 'admin_access_token';
const REFRESH_TOKEN_COOKIE = 'jwt';

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
    private readonly tokenService: AdminTokenService,
  ) {}

  async login(username?: string, password?: string) {
    if (!username || !password) {
      throwVbenError(
        'Username and password are required',
        HttpStatus.BAD_REQUEST,
        'BadRequestException',
      );
    }

    const user = await this.findUserByUsername(username);
    if (!user || user.password !== password) {
      throwVbenError(
        'Username or password is incorrect.',
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: this.tokenService.signRefreshToken(user),
      user,
    };
  }

  async refresh(refreshToken?: string) {
    if (!refreshToken) {
      throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);
    }

    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    if (!payload) throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);

    const user = await this.findUserByUsername(payload.username);
    if (!user) throwVbenError('Forbidden Exception', HttpStatus.FORBIDDEN);

    return {
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: this.tokenService.signRefreshToken(user),
    };
  }

  async currentUser(authHeader?: string, req?: Request) {
    const tokens = [
      this.readBearerToken(authHeader),
      this.readCookie(req, ACCESS_TOKEN_COOKIE),
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
    if (!user) throwVbenError('Unauthorized Exception', HttpStatus.UNAUTHORIZED);
    return user;
  }

  getRefreshTokenFromRequest(req: Request) {
    return this.readCookie(req, REFRESH_TOKEN_COOKIE);
  }

  setAccessTokenCookie(res: Response, token: string) {
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
      ...this.getTokenCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  setRefreshTokenCookie(res: Response, token: string) {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      ...this.getTokenCookieOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  clearRefreshTokenCookie(res: Response) {
    this.clearTokenCookie(res, REFRESH_TOKEN_COOKIE);
  }

  clearAccessTokenCookie(res: Response) {
    this.clearTokenCookie(res, ACCESS_TOKEN_COOKIE);
  }

  private async findUserByUsername(username: string) {
    return this.userRepository.findOne({
      relations: ['roles', 'roles.menus'],
      where: {
        isDeleted: false,
        status: 1,
        username,
      },
    });
  }

  private readBearerToken(authHeader?: string) {
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.split(' ')[1];
  }

  private readCookie(req: Request | undefined, cookieName: string) {
    const cookie = req?.headers.cookie || '';
    const cookies = cookie
      .split(';')
      .reduce<Record<string, string>>((acc, item) => {
        const [key, ...value] = item.trim().split('=');
        if (key) acc[key] = decodeURIComponent(value.join('='));
        return acc;
      }, {});
    return cookies[cookieName];
  }

  private getTokenCookieOptions() {
    const secure = process.env.ADMIN_COOKIE_SECURE === 'true';
    return {
      httpOnly: true,
      path: '/',
      sameSite: secure ? ('none' as const) : ('lax' as const),
      secure,
    };
  }

  private clearTokenCookie(res: Response, cookieName: string) {
    const options = this.getTokenCookieOptions();
    res.clearCookie(cookieName, options);
    // 兼容旧版本未显式指定 path 时由浏览器按接口路径生成的 cookie。
    res.clearCookie(cookieName, { ...options, path: '/api/auth' });
    res.clearCookie(cookieName, { ...options, path: '/auth' });
  }
}
