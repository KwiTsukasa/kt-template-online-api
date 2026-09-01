import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MediaScrapeValidationInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /**
   * 使用定长安全比较校验 NAS 刮削校验执行器的内部密钥。
   * @param context - 提供当前 HTTP 请求头的执行上下文。
   * @returns 密钥精确匹配时返回 `true`。
   * @throws 当服务端密钥缺失或请求密钥不匹配时抛出 `ForbiddenException`。
   */
  canActivate(context: ExecutionContext) {
    const expectedValue = String(
      this.config.get<string>('MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET') ??
        '',
    ).trim();
    if (expectedValue.length < 32 || expectedValue.length > 512) {
      throw new ForbiddenException('media-scrape-validation-auth-failed');
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers['x-kt-media-executor-secret'];
    let headerValue = '';
    if (typeof header === 'string') headerValue = header;
    if (Array.isArray(header)) headerValue = header[0] ?? '';
    const actual = Buffer.from(headerValue);
    const expected = Buffer.from(expectedValue);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new ForbiddenException('media-scrape-validation-auth-failed');
    }
    return true;
  }
}
