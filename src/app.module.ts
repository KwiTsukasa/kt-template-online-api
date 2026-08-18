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
  SecurityBoundaryModule,
} from './common';
import { AdminModule } from './modules/admin/admin.module';
import { AssetModule } from './modules/asset/asset.module';
import { BlogContentModule } from './modules/blog/blog-content.module';
import { MessageManagementModule } from './modules/message-management/message-management.module';
import { QqbotCoreModule } from './modules/qqbot/core/qqbot-core.module';
import { QqbotMessageSubscriberModule } from './modules/qqbot/message-management-adapter/qqbot-message-subscriber.module';
import { QqbotNapcatModule } from './modules/qqbot/napcat/qqbot-napcat.module';
import { QqbotPluginPlatformModule } from './modules/qqbot/plugin-platform/plugin-platform.module';
import { RuntimeModule } from './runtime';

/**
 * 根据`configService`构造TypeORM选项；从 `configService.get` 读取TypeORM选项。
 * @param configService - 读取类型ORM选项所需运行配置的配置服务。
 * @returns 包含 `type`、`host`、`port`、`username`、`password` 字段的类型ORM选项。
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
      useFactory: (configService: ConfigService) =>
        createPinoLoggerParams(configService),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) =>
        buildTypeOrmOptions(configService),
      inject: [ConfigService],
    }),
    MinioModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
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
    SecurityBoundaryModule,
    RuntimeModule,
    AdminModule,
    BlogContentModule,
    AssetModule,
    MessageManagementModule,
    QqbotCoreModule,
    QqbotMessageSubscriberModule,
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
