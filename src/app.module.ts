import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MinioModule } from 'nestjs-minio-client';
import { MinioClientModule } from './minio/minio.module';
import { SaveBodyInterceptor } from './common';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
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
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
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
    MinioClientModule,
    AdminModule,
  ],
  providers: [
    AppService,
    ConfigService,
    {
      provide: APP_INTERCEPTOR,
      useClass: SaveBodyInterceptor,
    },
  ],
})
export class AppModule {}
