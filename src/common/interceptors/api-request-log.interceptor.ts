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

  private ensureRequestId(request: RequestWithId, response: Response) {
    const requestId = this.toolsService.getRequestId(request) || randomUUID();
    request.id = requestId;

    if (!response.getHeader('x-request-id')) {
      response.setHeader('x-request-id', requestId);
    }

    return requestId;
  }

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

  private shouldSkipLokiPublish(path: unknown) {
    const normalizedPath = this.toolsService.normalizeRequestPathValue(path);
    return (
      normalizedPath === '/system/logs' ||
      normalizedPath.startsWith('/system/logs/')
    );
  }

  private shouldSkipSystemNotice(path: unknown) {
    const normalizedPath = this.toolsService.normalizeRequestPathValue(path);
    return (
      normalizedPath === '/system/logs' ||
      normalizedPath.startsWith('/system/logs/') ||
      normalizedPath === '/system/notice' ||
      normalizedPath.startsWith('/system/notice/')
    );
  }

  private getStatusCode(error: unknown, response: Response) {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (error) return 500;
    return response.statusCode || 200;
  }
}
