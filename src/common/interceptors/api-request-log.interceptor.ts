import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { LokiLogPublisherService } from '../logger/loki-log-publisher.service';
import {
  SYSTEM_NOTICE_PUBLISHER,
  SystemNoticePublisher,
} from '../notice/system-notice-publisher';
import { ToolsService } from '../services/tool.service';

type RequestWithId = Request & {
  id?: string;
};

@Injectable()
export class ApiRequestLogInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: PinoLogger,
    private readonly lokiLogPublisherService: LokiLogPublisherService,
    private readonly toolsService: ToolsService,
    @Optional()
    @Inject(SYSTEM_NOTICE_PUBLISHER)
    private readonly systemNoticePublisher?: SystemNoticePublisher,
  ) {
    this.logger.setContext(ApiRequestLogInterceptor.name);
  }

  /**
   * 拦截请求并处理横切逻辑。
   * @param context - 用于拦截请求并处理横切逻辑的领域对象，包含 `getType`、`switchToHttp` 字段。
   * @param next - 用于拦截请求并处理横切逻辑的领域对象，包含 `handle` 字段。
   * @returns 拦截请求并处理横切逻辑。
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithId>();
    const response = httpContext.getResponse<Response>();
    const startedAt = Date.now();
    const requestId = this.ensureRequestId(request, response);

    return next.handle().pipe(
      tap(() => {
        this.logRequest({
          request,
          requestId,
          response,
          startedAt,
        });
      }),
      catchError((error) => {
        this.logRequest({
          error,
          request,
          requestId,
          response,
          startedAt,
        });
        return throwError(() => error);
      }),
    );
  }

  /**
   * 确保标识存在且保持一致；缺失时根据`request`、`response`补齐对应状态；从 `toolsService.getRequestId` 读取标识。
   * @param request - 用于标识的当前 HTTP 请求，包含 `id` 字段。
   * @param response - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   * @returns 标识。
   */
  private ensureRequestId(request: RequestWithId, response: Response) {
    const requestId = this.toolsService.getRequestId(request) || randomUUID();
    request.id = requestId;

    if (!response.getHeader('x-request-id')) {
      response.setHeader('x-request-id', requestId);
    }

    return requestId;
  }

  /**
   * 根据`params`处理日志；当 `statusCode >= 500` 成立时直接结束且不产生返回值。
   * @param params - 用于日志的领域对象，包含 `error`、`response`、`startedAt`、`request` 字段。
   */
  private logRequest(params: {
    error?: unknown;
    request: RequestWithId;
    requestId: string;
    response: Response;
    startedAt: number;
  }) {
    const statusCode = this.getStatusCode(params.error, params.response);
    const payload = {
      durationMs: Date.now() - params.startedAt,
      method: params.request.method,
      path: this.toolsService.getRequestPath(params.request),
      requestId: params.requestId,
      statusCode,
    };

    if (statusCode >= 500) {
      this.publishRequestLog({
        error: params.error,
        level: 'error',
        message: 'HTTP request failed',
        payload,
      });
      this.publishSystemNotice({
        error: params.error,
        payload,
      });
      this.logger.error(
        {
          ...payload,
          err: params.error,
        },
        'HTTP request failed',
      );
      return;
    }

    if (statusCode >= 400) {
      this.publishRequestLog({
        level: 'warning',
        message: 'HTTP request completed',
        payload,
      });
      this.logger.warn(payload, 'HTTP request completed');
      return;
    }

    this.publishRequestLog({
      level: 'info',
      message: 'HTTP request completed',
      payload,
    });
    this.logger.info(payload, 'HTTP request completed');
  }

  /**
   * 通过 `shouldSkipLokiPublish` 判断输入是否满足函数约束。
   * @param params - 用于日志的领域对象，包含 `payload`、`error`、`level`、`message` 字段。
   */
  private publishRequestLog(params: {
    error?: unknown;
    level: 'error' | 'info' | 'warning';
    message: string;
    payload: Record<string, unknown>;
  }) {
    if (this.shouldSkipLokiPublish(params.payload.path)) return;

    void this.lokiLogPublisherService
      .pushHttpRequestLog({
        context: ApiRequestLogInterceptor.name,
        error: params.error,
        level: params.level,
        message: params.message,
        payload: params.payload,
      })
      .catch(() => undefined);
  }

  /**
   * 按`params`投递System通知；当 `!this.systemNoticePublisher || this.shouldSkipSystemNotice(pa…` 成立时直接结束且不产生返回值。
   * @param params - 用于System通知的领域对象，包含 `payload`、`error` 字段。
   */
  private publishSystemNotice(params: {
    error?: unknown;
    payload: Record<string, unknown>;
  }) {
    const method = this.toolsService.toTrimmedString(params.payload.method);
    const path = this.toolsService.normalizeRequestPathValue(
      params.payload.path,
    );
    const statusCode = Number(params.payload.statusCode) || 500;

    if (!this.systemNoticePublisher || this.shouldSkipSystemNotice(path)) {
      return;
    }

    const errorMessage = this.toolsService.getErrorMessage(
      params.error,
      'HTTP request failed',
    );

    void this.systemNoticePublisher
      .publishSystemNotice({
        content: errorMessage,
        dedupeKey: `api:error:${method}:${path}:${statusCode}`,
        eventType: 'api.error',
        metadata: {
          ...params.payload,
          errorMessage,
        },
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'api',
        summary: `${statusCode} ${method} ${path}`,
        title: `接口错误：${method} ${path}`,
      })
      .catch(() => undefined);
  }

  /**
   * 根据`path`与当前约束判定SkipLoki。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 满足SkipLoki约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldSkipLokiPublish(path: unknown) {
    const normalizedPath = this.toolsService.normalizeRequestPathValue(path);
    return (
      normalizedPath === '/system/logs' ||
      normalizedPath.startsWith('/system/logs/')
    );
  }

  /**
   * 根据`path`与当前约束判定SkipSystem通知。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 满足SkipSystem通知约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private shouldSkipSystemNotice(path: unknown) {
    const normalizedPath = this.toolsService.normalizeRequestPathValue(path);
    return (
      normalizedPath === '/system/logs' ||
      normalizedPath.startsWith('/system/logs/') ||
      normalizedPath === '/system/notice' ||
      normalizedPath.startsWith('/system/notice/')
    );
  }

  /**
   * 按`error`、`response`读取状态代码；当 `error instanceof HttpException` 成立时返回 `error.getStatus()`。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @param response - 包含 `statusCode` 字段的上游服务响应。
   * @returns 规范化后的状态代码；主值为空时采用 `200` 兜底。
   */
  private getStatusCode(error: unknown, response: Response) {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (error) return 500;
    return response.statusCode || 200;
  }
}
