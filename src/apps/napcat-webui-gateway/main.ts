import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { json, urlencoded } from 'express';
import { NapcatWebuiGatewayConfigService } from './config/napcat-webui-gateway-config.service';
import { NapcatWebuiGatewayModule } from './napcat-webui-gateway.module';

/**
 * Starts the standalone NapCat WebUI Gateway process.
 */
async function bootstrap() {
  const app = await NestFactory.create(NapcatWebuiGatewayModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ extended: true, limit: '64kb' }));
  await app.listen(app.get(NapcatWebuiGatewayConfigService).port());
}

bootstrap();
