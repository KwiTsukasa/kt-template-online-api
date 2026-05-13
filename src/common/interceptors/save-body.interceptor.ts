import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import type { Request } from 'express';

const SKIP_SAVE_BODY_NORMALIZE = 'SKIP_SAVE_BODY_NORMALIZE';

export const SkipSaveBodyNormalize = () =>
  SetMetadata(SKIP_SAVE_BODY_NORMALIZE, true);

@Injectable()
export class SaveBodyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (this.shouldSkip(context)) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (this.isSaveRequest(request) && request.body) {
      // 新增接口统一忽略前端传入的 id，避免 TypeORM save 走指定主键写入。
      delete request.body.id;
    }

    return next.handle();
  }

  private shouldSkip(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(SKIP_SAVE_BODY_NORMALIZE, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  private isSaveRequest(request: Request): boolean {
    return request.method === 'POST' && request.path.endsWith('/save');
  }
}
