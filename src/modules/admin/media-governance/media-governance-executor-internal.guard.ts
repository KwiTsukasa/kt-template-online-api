import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MediaGovernanceExecutorInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const expectedValue = String(
      this.config.get<string>('MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET') ??
        '',
    ).trim();
    if (expectedValue.length < 32 || expectedValue.length > 512) {
      throw new ForbiddenException('media-governance-executor-auth-failed');
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers['x-kt-media-executor-secret'];
    const actual = Buffer.from(
      Array.isArray(header) ? (header[0] ?? '') : (header ?? ''),
    );
    const expected = Buffer.from(expectedValue);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new ForbiddenException('media-governance-executor-auth-failed');
    }
    return true;
  }
}
