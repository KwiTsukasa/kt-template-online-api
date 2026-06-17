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

/**
 * 执行 当前模块流程。
 */
export const SkipSaveBodyNormalize = () =>
  SetMetadata(SKIP_SAVE_BODY_NORMALIZE, true);

@Injectable()
export class SaveBodyInterceptor implements NestInterceptor {
  /**
   * 初始化 SaveBodyInterceptor 实例。
   * @param reflector - Nest Reflector 实例；影响 constructor 的返回值。
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * 拦截请求并处理横切逻辑。
   * @param context - context 输入；执行 `context.switchToHttp()` 对应的 公共基础设施步骤。
   * @param next - next 输入；执行 `next.handle()` 对应的 公共基础设施步骤。
   * @returns 当前模块产出的 Observable<any>。
   */
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

  /**
   * 判断 当前模块条件。
   * @param context - context 输入；执行 `context.getHandler()`、`context.getClass()` 对应的 公共基础设施步骤。
   * @returns 布尔值，表示 当前模块条件是否满足。
   */
  private shouldSkip(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(SKIP_SAVE_BODY_NORMALIZE, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  /**
   * 判断 当前模块条件。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @returns 布尔值，表示 当前模块条件是否满足。
   */
  private isSaveRequest(request: Request): boolean {
    return request.method === 'POST' && request.path.endsWith('/save');
  }
}
