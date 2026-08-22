import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { TencentBotWebhookController } from '@/modules/bot-adapter/tencent/contract/tencent-bot-webhook.controller';
import { TencentBotService } from '@/modules/bot-adapter/tencent/infrastructure/tencent-bot.service';

describe('TencentBotWebhookController', () => {
  let app: INestApplication & NestExpressApplication;
  const handleWebhook = jest.fn().mockResolvedValue({
    body: { d: 0, op: 12 },
    status: 200,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TencentBotWebhookController],
      providers: [
        {
          provide: TencentBotService,
          useValue: { handleWebhook },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.useBodyParser('json', { limit: '50mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '50mb' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handleWebhook.mockClear();
  });

  it('preserves the exact JSON bytes and forwards official signature headers', async () => {
    const payload = {
      d: { content: 'Webhook 原始请求体', id: 'message-1' },
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
    };
    await request(app.getHttpServer())
      .post(
        '/bot-adapter/tencent/webhook/1020000000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      )
      .set('X-Signature-Ed25519', 'signed-value')
      .set('X-Signature-Timestamp', '1724295660')
      .send(payload)
      .expect(200)
      .expect({ d: 0, op: 12 });

    expect(handleWebhook).toHaveBeenCalledTimes(1);
    const input = handleWebhook.mock.calls[0][0];
    expect(Buffer.isBuffer(input.body)).toBe(true);
    expect(JSON.parse(input.body.toString('utf8'))).toEqual(payload);
    expect(input).toEqual(
      expect.objectContaining({
        appId: '1020000000',
        signature: 'signed-value',
        timestamp: '1724295660',
        webhookToken:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    );
  });
});
