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

/**
 * Converts safe system-message domain failures at the management HTTP boundary.
 * It intentionally leaves every unrelated error untouched for the global exception filter.
 */
@Injectable()
export class QqbotMessagePushContractErrorInterceptor implements NestInterceptor {
  /**
   * Translates synchronous and asynchronous system-message contract errors into Vben HTTP errors.
   * @param _context - Current Nest execution context; this boundary does not inspect request state.
   * @param next - The controller handler stream to observe for domain failures.
   * @returns The original handler stream or a Vben-safe mapped HTTP exception.
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
   * Classifies a stable domain code using the management API's documented 4xx semantics.
   * @param code - Non-sensitive system-message contract code.
   * @returns HTTP 404 for absent resources, 409 for mutable-state conflicts, otherwise 400.
   */
  private resolveStatus(code: string): HttpStatus {
    if (NOT_FOUND_CODES.has(code)) return HttpStatus.NOT_FOUND;
    if (CONFLICT_CODE_PATTERN.test(code)) return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }
}
