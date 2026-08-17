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

  /**
   * 捕获并转换异常响应。
   * @param exception - 决定捕获并转换异常响应内容、边界或目标的 `exception` 值。
   * @param host - 可能包含认证信息或端口的外部服务地址。
   */
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

  /**
   * 根据`params`处理针对异常响应；当 `params.status >= 500` 成立时直接结束且不产生返回值。
   * @param params - 用于针对异常响应的领域对象，包含 `exception`、`err`、`request`、`status` 字段。
   */
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

  /**
   * 按`exception`读取针对异常响应；当 `exception instanceof HttpException` 成立时返回 `exception.getStatus()`。
   * @param exception - 用于针对异常响应的领域对象，包含 `getStatus` 字段。
   * @returns 针对异常响应。
   */
  private getStatus(exception: unknown) {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * 按`exception`读取针对异常响应；当 `!(exception instanceof HttpException)` 成立时返回 `null`。
   * @param exception - 用于针对异常响应的领域对象，包含 `getResponse` 字段。
   * @returns 针对异常响应；无法解析或未命中时为 `null`。
   */
  private getBody(exception: unknown): ExceptionBody | string | null {
    if (!(exception instanceof HttpException)) {
      return null;
    }

    const body = exception.getResponse();

    if (typeof body === 'string') {
      return body;
    }
    return (body as ExceptionBody);
  }

  /**
   * 按`status`、`body`、`exception`读取针对异常响应；当 `status >= 500` 成立时返回 `'Internal server error'`。
   * @param status - 决定针对异常响应内容、边界或目标的 `status` 值。
   * @param body - 用于针对异常响应的结构化输入，包含 `msg`、`message` 字段。
   * @param exception - 用于针对异常响应的领域对象，包含 `message` 字段。
   * @returns 当前状态对应的针对异常响应，取值为 `'Internal server error'`、`'操作失败'`。
   */
  private getMessage(
    status: number,
    body: ExceptionBody | string | null,
    exception: unknown,
  ) {
    if (typeof body === 'string') return body;
    if (body?.msg) return this.stringifyMessage(body.msg);
    if (body?.message) return this.stringifyMessage(body.message);
    if (exception instanceof Error && status < 500) return exception.message;

    if (status >= 500) {
      return 'Internal server error';
    }
    return '操作失败';
  }

  /**
   * 按`status`、`body`、`exception`读取针对异常响应；当 `status >= HttpStatus.INTERNAL_SERVER_ERROR && !(exception ins…` 成立时返回 `'Internal server error'`。
   * @param status - 决定针对异常响应内容、边界或目标的 `status` 值。
   * @param body - 用于针对异常响应的结构化输入，包含 `err`、`error`、`message` 字段。
   * @param exception - 用于针对异常响应的领域对象，包含 `message` 字段。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 当前状态对应的针对异常响应，取值为 `'Internal server error'`、`'操作失败'`。
   */
  private getErr(
    status: number,
    body: ExceptionBody | string | null,
    exception: unknown,
    fallback: string,
  ) {
    if (
      status >= HttpStatus.INTERNAL_SERVER_ERROR &&
      !(exception instanceof HttpException)
    ) {
      return 'Internal server error';
    }
    if (typeof body === 'string') return normalizeVbenErrorText(body, fallback);
    if (body?.err !== undefined)
      return normalizeVbenErrorText(body.err, fallback);
    if (body?.error !== undefined)
      return normalizeVbenErrorText(body.error, fallback);
    if (body?.message !== undefined)
      return normalizeVbenErrorText(body.message, fallback);
    if (exception instanceof Error)
      return normalizeVbenErrorText(exception.message, fallback);

    if (status >= 500) {
      return 'Internal server error';
    }
    return '操作失败';
  }

  /**
   * 将`message`转换为针对异常响应。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 针对异常响应。
   */
  private stringifyMessage(message: unknown) {
    return normalizeVbenErrorText(message);
  }

  /**
   * 按`exception`、`fallback`读取针对异常响应。
   * @param exception - 决定针对异常响应内容、边界或目标的 `exception` 值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 包含 `message`、`raw` 字段的针对异常响应。
   */
  private getLogError(exception: unknown, fallback: string) {
    if (exception instanceof Error) return exception;
    return {
      message: fallback,
      raw: normalizeVbenErrorText(exception, fallback),
    };
  }
}
