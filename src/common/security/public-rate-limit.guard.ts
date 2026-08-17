import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PublicRateLimitService } from './public-rate-limit.service';
import type { PublicRateLimitOutcome } from './public-rate-limit.service';
import { TrustedCredentialTransportService } from './trusted-credential-transport.service';

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: PublicRateLimitService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
  ) {}

  /**
   * 根据`context`与当前约束判定是否允许激活；先通过 `trustedCredentialTransportService.assertProtectedRequest` 校验输入边界。
   * @param context - 用于是否允许激活的领域对象，包含 `getType`、`switchToHttp`、`getHandler`、`getClass` 字段。
   * @returns 满足是否允许激活约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    this.trustedCredentialTransportService.assertProtectedRequest(request);
    const response = context.switchToHttp().getResponse<Response>();
    const explicitlyPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    const outcome = await this.rateLimitService.consume(request, {
      explicitlyPublic,
    });
    this.assertAllowed(response, outcome);
    return true;
  }

  /**
   * 校验`response`、`outcome`是否满足允许的约束，并拒绝不合法输入。
   * @param response - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   * @param outcome - 用于允许的的领域对象，包含 `allowed`、`retryAfterSeconds`、`statusCode` 字段。
   * @throws 限流结果为禁止、存储不可用或请求过多时分别抛出对应的 HTTP 异常。
   */
  assertAllowed(response: Response, outcome: PublicRateLimitOutcome): void {
    if (outcome.allowed) return;

    if (outcome.retryAfterSeconds) {
      response.setHeader('Retry-After', String(outcome.retryAfterSeconds));
    }
    if (outcome.statusCode === HttpStatus.FORBIDDEN) {
      throw new ForbiddenException('当前来源无权访问接口文档');
    }
    if (outcome.statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
      throw new ServiceUnavailableException('登录限流服务暂不可用');
    }

    throw new HttpException(
      '请求过于频繁，请稍后重试',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
