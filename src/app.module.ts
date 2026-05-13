import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MinioModule } from 'nestjs-minio-client';
import { ComponentModule } from './component/component.module';
import { DictModule } from './dict/dict.module';
import { MinioClientModule } from './minio/minio.module';
import { SaveMiddleware } from './middleware/save.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env${
        process.env.NODE_ENV ? `.${process.env.NODE_ENV}` : ''
      }`,
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
          synchronize: configService.get('DB_SYNC'),
          entities: [__dirname + '/**/*.entity.js'],
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
    ComponentModule,
    DictModule,
    MinioClientModule,
  ],
  providers: [AppService, ConfigService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SaveMiddleware).forRoutes('*/save');
  }
}
