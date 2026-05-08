import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { urlencoded, json } from 'express';
import { knife4jSetup } from 'nestjs-knife4j-plus';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  const options = new DocumentBuilder()
    .setTitle('KT-Template API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api', app, document);

  // 启用knife4j增强（关键代码）
  knife4jSetup(app, [
    {
      name: '1.0', // 文档版本名称
      url: `/api-json`, // Swagger openapi JSON地址
    },
  ]);

  await app.listen(48085);
}
bootstrap();
