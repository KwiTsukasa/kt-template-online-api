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

  /**
   * 拦截请求并处理横切逻辑。
   * @param context - 用于拦截请求并处理横切逻辑的领域对象，包含 `switchToHttp` 字段。
   * @param next - 用于拦截请求并处理横切逻辑的领域对象，包含 `handle` 字段。
   * @returns 拦截请求并处理横切逻辑。
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
   * 根据`context`与当前约束判定Skip；从 `reflector.getAllAndOverride` 读取Skip。
   * @param context - 用于Skip的领域对象，包含 `getHandler`、`getClass` 字段。
   * @returns 满足Skip约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldSkip(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(SKIP_SAVE_BODY_NORMALIZE, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  /**
   * 通过 `request.path.endsWith` 判断输入是否满足函数约束。
   * @param request - 用于`isSaveRequest` 对应结果的当前 HTTP 请求，包含 `method`、`path` 字段。
   * @returns 满足`isSaveRequest` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isSaveRequest(request: Request): boolean {
    return request.method === 'POST' && request.path.endsWith('/save');
  }
}
