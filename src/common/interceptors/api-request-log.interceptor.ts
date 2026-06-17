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
  /**
   * 初始化 ApiRequestLogInterceptor 实例。
   * @param logger - 日志记录器实例；绑定日志上下文名称。
   * @param lokiLogPublisherService - lokiLogPublisherService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param systemNoticePublisher - systemNoticePublisher 输入；影响 constructor 的返回值。
   */
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
   * @param context - context 输入；执行 `context.getType()`、`context.switchToHttp()` 对应的 公共基础设施步骤。
   * @param next - next 输入；执行 `next.handle()` 对应的 公共基础设施步骤。
   * @returns 当前模块产出的 Observable<any>。
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
   * 确保Request Id。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param response - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
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
   * 执行 当前模块流程。
   * @param params - 公共基础设施列表；使用 `error`、`response`、`startedAt`、`request` 字段生成结果。
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
   * 投递 当前模块消息或任务。
   * @param params - 公共基础设施列表；使用 `payload`、`error`、`level`、`message` 字段生成结果。
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
   * 投递 当前模块消息或任务。
   * @param params - 公共基础设施列表；使用 `payload`、`error` 字段生成结果。
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
   * 判断 当前模块条件。
   * @param path - 路由或文件路径；驱动 `toolsService.normalizeRequestPathValue()` 的 公共基础设施步骤。
   */
  private shouldSkipLokiPublish(path: unknown) {
    const normalizedPath = this.toolsService.normalizeRequestPathValue(path);
    return (
      normalizedPath === '/system/logs' ||
      normalizedPath.startsWith('/system/logs/')
    );
  }

  /**
   * 判断 当前模块条件。
   * @param path - 路由或文件路径；驱动 `toolsService.normalizeRequestPathValue()` 的 公共基础设施步骤。
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
   * 查询 当前模块数据。
   * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   * @param response - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  private getStatusCode(error: unknown, response: Response) {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (error) return 500;
    return response.statusCode || 200;
  }
}
