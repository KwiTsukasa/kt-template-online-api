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
  /**
   * 初始化 ApiExceptionFilter 实例。
   * @param logger - 日志记录器实例；绑定日志上下文名称。
   */
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ApiExceptionFilter.name);
  }

  /**
   * 捕获并转换异常响应。
   * @param exception - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   * @param host - host 输入；执行 `host.switchToHttp()` 对应的 公共基础设施步骤。
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
   * 执行 异常响应流程。
   * @param params - 公共基础设施列表；使用 `exception`、`err`、`request`、`status` 字段生成结果。
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
   * 查询 异常响应数据。
   * @param exception - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   */
  private getStatus(exception: unknown) {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * 查询 异常响应数据。
   * @param exception - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   * @returns 异常响应查询结果。
   */
  private getBody(exception: unknown): ExceptionBody | string | null {
    if (!(exception instanceof HttpException)) {
      return null;
    }

    const body = exception.getResponse();

    return typeof body === 'string' ? body : (body as ExceptionBody);
  }

  /**
   * 查询 异常响应数据。
   * @param status - 公共基础设施列表；决定 公共基础设施条件分支。
   * @param body - 请求体 DTO；承载 公共基础设施新增、更新、导入或执行字段。
   * @param exception - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
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

    return status >= 500 ? 'Internal server error' : '操作失败';
  }

  /**
   * 查询 异常响应数据。
   * @param status - 公共基础设施列表；限定 公共基础设施查询范围。
   * @param body - 请求体 DTO；承载 公共基础设施新增、更新、导入或执行字段。
   * @param exception - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   * @param fallback - 兜底值；限定 公共基础设施查询范围。
   */
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

  /**
   * 执行 异常响应流程。
   * @param message - message 输入；生成统一错误文案。
   */
  private stringifyMessage(message: unknown) {
    return normalizeVbenErrorText(message);
  }

  /**
   * 查询 异常响应数据。
   * @param exception - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   * @param fallback - 默认日志错误文本；在异常体缺少可读消息时作为日志输出兜底。
   */
  private getLogError(exception: unknown, fallback: string) {
    if (exception instanceof Error) return exception;
    return {
      message: fallback,
      raw: normalizeVbenErrorText(exception, fallback),
    };
  }
}
