import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { LoggerModule } from 'nestjs-pino';
import { createPinoLoggerParams } from '@/common';
import { NapcatWebuiGatewaySessionService } from './application/napcat-webui-gateway-session.service';
import { NapcatWebuiGatewayConfigService } from './config/napcat-webui-gateway-config.service';
import { NAPCAT_WEBUI_GATEWAY_SESSION_STORE } from './domain/napcat-webui-gateway.types';
import { NapcatWebuiCredentialClient } from './infrastructure/napcat-webui-credential.client';
import { NapcatWebuiProxyService } from './infrastructure/proxy/napcat-webui-proxy.service';
import { NapcatWebuiGatewayRedisStore } from './infrastructure/session/napcat-webui-gateway-redis.store';
import { NapcatWebuiGatewayTicketService } from './infrastructure/session/napcat-webui-gateway-ticket.service';
import { InternalSessionController } from './presentation/internal-session.controller';
import { PublicWebuiController } from './presentation/public-webui.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      /**
       * Builds pino logger options from the shared API logging config.
       * @param configService - Nest ConfigService dependency.
       * @returns LoggerModule options.
       */
      useFactory: (configService: ConfigService) =>
        createPinoLoggerParams(configService),
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      /**
       * Builds the Gateway Redis module options.
       * @param configService - Nest ConfigService dependency.
       * @returns @nestjs-modules/ioredis single-connection options.
       */
      useFactory: (configService: ConfigService) => {
        const config = new NapcatWebuiGatewayConfigService(configService);
        return {
          type: 'single' as const,
          url: config.redisUrl(),
        };
      },
    }),
  ],
  controllers: [InternalSessionController, PublicWebuiController],
  providers: [
    NapcatWebuiGatewayConfigService,
    NapcatWebuiCredentialClient,
    NapcatWebuiProxyService,
    NapcatWebuiGatewaySessionService,
    NapcatWebuiGatewayRedisStore,
    NapcatWebuiGatewayTicketService,
    {
      provide: NAPCAT_WEBUI_GATEWAY_SESSION_STORE,
      useExisting: NapcatWebuiGatewayRedisStore,
    },
  ],
})
export class NapcatWebuiGatewayModule {}
