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
import { QqbotPluginPlatformModule } from './modules/qqbot/plugin-platform/plugin-platform.module';
import { WordpressMirrorModule } from './modules/wordpress/wordpress-mirror.module';
import { RuntimeModule } from './runtime';

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
      useFactory: async (configService: ConfigService) => {
        return {
          type: 'mysql',
          host: configService.get('DB_HOST'),
          port: configService.get('DB_PORT'),
          username: configService.get('DB_USERNAME'),
          password: configService.get('DB_PASSWORD'),
          database: configService.get('DB_DATABASE'),
          synchronize: configService.get<string>('DB_SYNC') === 'true',
          entities: [
            __dirname + '/**/*.entity{.ts,.js}',
            __dirname + '/**/*.entities{.ts,.js}',
          ],
          subscribers: [__dirname + '/**/*.subscriber{.ts,.js}'],
        };
      },
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
    RuntimeModule,
    AdminModule,
    BlogContentModule,
    WordpressMirrorModule,
    AssetModule,
    QqbotCoreModule,
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
