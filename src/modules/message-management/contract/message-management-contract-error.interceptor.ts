import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { throwVbenError } from '@/common';
import { catchError, type Observable } from 'rxjs';
import { SystemMessageContractError } from './message-management.types';

const NOT_FOUND_CODES = new Set(['unknown_message_source']);

const CONFLICT_CODE_PATTERN =
  /(?:^|_)(?:duplicate|disabled|unavailable|superseded|mismatch|not_synced)(?:_|$)/;

@Injectable()
export class MessageManagementContractErrorInterceptor implements NestInterceptor {
  /**
   * 把消息协议契约错误映射为统一 HTTP 响应。
   * @param _context - 为兼容既有调用签名保留；当前实现不会读取该参数。
   * @param next - 提供消息协议处理结果或契约异常的调用链。
   * @returns 应用统一契约错误映射后的响应流。
   */
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!(error instanceof SystemMessageContractError)) throw error;
        return throwVbenError(
          error.code,
          this.resolveStatus(error.code),
          error.code,
        );
      }),
    );
  }

  /**
   * 将通用错误语义映射为 HTTP 状态，未知协议方错误码回退为客户端请求错误。
   * @param code - 不包含具体渠道知识的消息协议错误码。
   * @returns 与错误语义对应的 HTTP 状态。
   */
  private resolveStatus(code: string): HttpStatus {
    if (NOT_FOUND_CODES.has(code)) return HttpStatus.NOT_FOUND;
    if (CONFLICT_CODE_PATTERN.test(code)) return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }
}
