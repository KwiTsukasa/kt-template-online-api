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

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: PublicRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
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
