import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MediaCodexAgentGatewayConfigService } from './config/media-codex-agent-gateway-config.service';
import { MediaCodexAgentGatewayModule } from './media-codex-agent-gateway.module';

async function bootstrap() {
  const app = await NestFactory.create(MediaCodexAgentGatewayModule, {
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
  const config = app.get(MediaCodexAgentGatewayConfigService);
  await app.listen(config.port(), config.host());
}

bootstrap();
