import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MinioModule } from 'nestjs-minio-client';
import {
  ApiRequestLogInterceptor,
  ApiExceptionFilter,
  CommonModule,
  createPinoLoggerParams,
  SaveBodyInterceptor,
} from './common';
import { AdminModule } from './modules/admin/admin.module';
import { AssetModule } from './modules/asset/asset.module';
import { BlogContentModule } from './modules/blog/blog-content.module';
import { QqbotCoreModule } from './modules/qqbot/core/qqbot-core.module';
import { QqbotNapcatModule } from './modules/qqbot/napcat/qqbot-napcat.module';
import { QqbotPluginPlatformModule } from './modules/qqbot/plugin-platform/plugin-platform.module';
import { WordpressMirrorModule } from './modules/wordpress/wordpress-mirror.module';
import { RuntimeModule } from './runtime';

/**
 * Builds TypeORM MySQL options from runtime config with an explicit session timezone.
 * @param configService - Nest ConfigService source for DB connection fields and DB_TIMEZONE override.
 * @returns TypeORM MySQL options consumed by AppModule startup.
 */
export function buildTypeOrmOptions(configService: ConfigService) {
  return {
    type: 'mysql' as const,
    host: configService.get('DB_HOST'),
    port: configService.get('DB_PORT'),
    username: configService.get('DB_USERNAME'),
    password: configService.get('DB_PASSWORD'),
    database: configService.get('DB_DATABASE'),
    timezone: configService.get<string>('DB_TIMEZONE') || '+08:00',
    synchronize: configService.get<string>('DB_SYNC') === 'true',
    entities: [
      __dirname + '/**/*.entity{.ts,.js}',
      __dirname + '/**/*.entities{.ts,.js}',
    ],
    subscribers: [__dirname + '/**/*.subscriber{.ts,.js}'],
  };
}

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
       * 创建 模块依赖注入工厂产物。
       * @param configService - Nest ConfigService 依赖；驱动 `createPinoLoggerParams()` 的 模块步骤。
       */
      useFactory: (configService: ConfigService) =>
        createPinoLoggerParams(configService),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      /**
       * 创建 模块依赖注入工厂产物。
       * @param configService - Nest ConfigService 依赖；使用 `get` 字段生成结果。
       */
      useFactory: async (configService: ConfigService) =>
        buildTypeOrmOptions(configService),
      inject: [ConfigService],
    }),
    MinioModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      /**
       * 创建 模块依赖注入工厂产物。
       * @param configService - Nest ConfigService 依赖；执行 `configService.get()` 对应的 模块步骤。
       */
      useFactory: (configService: ConfigService) => {
        return {
          endPoint: configService.get('MINIO_ENDPOINT'),
          port: parseInt(configService.get('MINIO_PORT')),
          useSSL: false,
          accessKey: configService.get('MINIO_ACCESS_KEY'),
          secretKey: configService.get('MINIO_SECRET_KEY'),
        };
      },
      inject: [ConfigService],
    }),
    CommonModule,
    RuntimeModule,
    AdminModule,
    BlogContentModule,
    WordpressMirrorModule,
    AssetModule,
    QqbotCoreModule,
    QqbotNapcatModule,
    QqbotPluginPlatformModule,
  ],
  providers: [
    AppService,
    ConfigService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiRequestLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SaveBodyInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule {}
