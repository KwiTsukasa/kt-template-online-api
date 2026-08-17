import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { throwVbenError } from '@/common';
import { catchError, type Observable } from 'rxjs';
import { SystemMessageContractError } from './qqbot-message-push.types';

const NOT_FOUND_CODES = new Set([
  'ddns_not_found',
  'mapping_not_found',
  'unknown_message_source',
]);

const CONFLICT_CODE_PATTERN =
  /(?:^|_)(?:duplicate|disabled|unavailable|superseded|mismatch|not_synced)(?:_|$)|^(?:mapping_not_managed|mapping_not_udp|ddns_not_ipv4|ddns_source_type_invalid|onebot_)/;

@Injectable()
export class QqbotMessagePushContractErrorInterceptor implements NestInterceptor {
  /**
   * 把消息推送契约错误映射为统一 HTTP 响应。
   * @param _context - 为兼容既有调用签名保留；当前实现不会读取该参数。
   * @param next - 用于把消息推送契约错误映射为统一 HTTP 响应的领域对象，包含 `handle` 字段。
   * @returns 把消息推送契约错误映射为统一 HTTP 响应。
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
   * 将消息推送合同错误码映射为对应 HTTP 状态，未知错误码回退为客户端请求错误。
   * @param code - 决定状态内容、边界或目标的 `code` 值。
   * @returns 状态。
   */
  private resolveStatus(code: string): HttpStatus {
    if (NOT_FOUND_CODES.has(code)) return HttpStatus.NOT_FOUND;
    if (CONFLICT_CODE_PATTERN.test(code)) return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }
}
