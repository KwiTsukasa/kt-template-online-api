import { RedisModule } from '@nestjs-modules/ioredis';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ClientIpService } from './client-ip.service';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { PublicRateLimitService } from './public-rate-limit.service';
import { RedisRateLimitStore } from './redis-rate-limit.store';
import { TrustedCredentialTransportService } from './trusted-credential-transport.service';

@Global()
@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const production = configService.get('NODE_ENV') === 'production';
        const host = readText(
          configService,
          'PUBLIC_RATE_LIMIT_REDIS_HOST',
          production ? '' : '127.0.0.1',
        );
        if (!host) {
          throw new Error('PUBLIC_RATE_LIMIT_REDIS_HOST 在生产环境不能为空');
        }

        return {
          type: 'single' as const,
          onClientReady: (client) => {
            client.on('error', () => undefined);
          },
          options: {
            connectTimeout: 2000,
            db: readInteger(
              configService,
              'PUBLIC_RATE_LIMIT_REDIS_DB',
              0,
              0,
              15,
            ),
            enableOfflineQueue: false,
            host,
            maxRetriesPerRequest: 1,
            password:
              readText(configService, 'PUBLIC_RATE_LIMIT_REDIS_PASSWORD') ||
              undefined,
            port: readInteger(
              configService,
              'PUBLIC_RATE_LIMIT_REDIS_PORT',
              6379,
              1,
              65535,
            ),
            retryStrategy: (attempt: number) =>
              Math.min(Math.max(100, attempt * 100), 2000),
          },
        };
      },
    }),
  ],
  providers: [
    ClientIpService,
    RedisRateLimitStore,
    PublicRateLimitService,
    TrustedCredentialTransportService,
    PublicRateLimitGuard,
    {
      provide: APP_GUARD,
      useExisting: PublicRateLimitGuard,
    },
  ],
  exports: [
    ClientIpService,
    PublicRateLimitService,
    RedisRateLimitStore,
    TrustedCredentialTransportService,
  ],
})
export class SecurityBoundaryModule {}

function readText(
  configService: ConfigService,
  key: string,
  fallback = '',
): string {
  const value = `${configService.get(key) ?? ''}`.trim();
  return value || fallback;
}

function readInteger(
  configService: ConfigService,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = configService.get<string | number>(key);
  if (raw === undefined || raw === null || `${raw}`.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}
