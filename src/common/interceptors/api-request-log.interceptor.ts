import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { ToolsService } from '../services/tool.service';

type RequestWithId = Request & {
  id?: string;
};

@Injectable()
export class ApiRequestLogInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: PinoLogger,
    private readonly toolsService: ToolsService,
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
      this.logger.warn(payload, 'HTTP request completed');
      return;
    }

    this.logger.info(payload, 'HTTP request completed');
  }

  private getStatusCode(error: unknown, response: Response) {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (error) return 500;
    return response.statusCode || 200;
  }
}
