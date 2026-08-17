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
  /** 返回拦截。 */
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

  /** 解析状态。 */
  private resolveStatus(code: string): HttpStatus {
    if (NOT_FOUND_CODES.has(code)) return HttpStatus.NOT_FOUND;
    if (CONFLICT_CODE_PATTERN.test(code)) return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }
}
