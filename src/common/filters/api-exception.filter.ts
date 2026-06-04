import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { normalizeVbenErrorText } from '../response/vben-response';
import type { ExceptionBody, KtErrorResponse } from '../types';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ApiExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = this.getStatus(exception);
    const body = this.getBody(exception);
    const msg = this.getMessage(status, body, exception);
    const err = this.getErr(status, body, exception, msg);

    this.logException({
      err,
      exception,
      msg,
      request,
      status,
    });

    response.status(status).json({
      code: status,
      msg,
      err,
    } satisfies KtErrorResponse);
  }

  private logException(params: {
    err: string;
    exception: unknown;
    msg: string;
    request: Request;
    status: number;
  }) {
    const payload = {
      err: this.getLogError(params.exception, params.err),
      method: params.request.method,
      path: params.request.originalUrl || params.request.url,
      requestId: `${(params.request as any).id || ''}`,
      statusCode: params.status,
    };

    if (params.status >= 500) {
      this.logger.error(payload, params.msg);
      return;
    }

    this.logger.warn(payload, params.msg);
  }

  private getStatus(exception: unknown) {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getBody(exception: unknown): ExceptionBody | string | null {
    if (!(exception instanceof HttpException)) {
      return null;
    }

    const body = exception.getResponse();

    return typeof body === 'string' ? body : (body as ExceptionBody);
  }

  private getMessage(
    status: number,
    body: ExceptionBody | string | null,
    exception: unknown,
  ) {
    if (typeof body === 'string') return body;
    if (body?.msg) return this.stringifyMessage(body.msg);
    if (body?.message) return this.stringifyMessage(body.message);
    if (exception instanceof Error && status < 500) return exception.message;

    return status >= 500 ? 'Internal server error' : '操作失败';
  }

  private getErr(
    status: number,
    body: ExceptionBody | string | null,
    exception: unknown,
    fallback: string,
  ) {
    if (typeof body === 'string') return normalizeVbenErrorText(body, fallback);
    if (body?.err !== undefined)
      return normalizeVbenErrorText(body.err, fallback);
    if (body?.error !== undefined)
      return normalizeVbenErrorText(body.error, fallback);
    if (body?.message !== undefined)
      return normalizeVbenErrorText(body.message, fallback);
    if (exception instanceof Error)
      return normalizeVbenErrorText(exception.message, fallback);

    return status >= 500 ? 'Internal server error' : '操作失败';
  }

  private stringifyMessage(message: unknown) {
    return normalizeVbenErrorText(message);
  }

  private getLogError(exception: unknown, fallback: string) {
    if (exception instanceof Error) return exception;
    return {
      message: fallback,
      raw: normalizeVbenErrorText(exception, fallback),
    };
  }
}
