import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { normalizeVbenErrorText } from '../response/vben-response';
import type { ExceptionBody, KtErrorResponse } from '../types';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = this.getStatus(exception);
    const body = this.getBody(exception);
    const msg = this.getMessage(status, body, exception);

    response.status(status).json({
      code: status,
      msg,
      err: this.getErr(status, body, exception, msg),
    } satisfies KtErrorResponse);
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
}
