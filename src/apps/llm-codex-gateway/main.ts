import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { LlmCodexGatewayConfigService } from './config/llm-codex-gateway-config.service';
import { LlmCodexGatewayModule } from './llm-codex-gateway.module';

/** 启动通用 LLM Codex 网关，并安装有界请求体与严格 DTO 校验。 */
async function bootstrap() {
  const app = await NestFactory.create(LlmCodexGatewayModule, {
    bodyParser: false,
  });
  app.use(json({ limit: '64kb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  const config = app.get(LlmCodexGatewayConfigService);
  await app.listen(config.port(), config.host());
}

bootstrap();
