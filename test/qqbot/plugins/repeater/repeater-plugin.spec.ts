import type { QqbotNormalizedMessage } from '@/modules/qqbot/core/contract/qqbot.types';
import { createPlugin } from '@/modules/qqbot/plugins/repeater/src';

function createMessage(text: string): QqbotNormalizedMessage {
  return {
    eventTime: new Date(),
    groupId: 'group-1',
    messageId: `message-${text}-${Date.now()}`,
    messageText: text,
    messageType: 'group',
    rawEvent: {},
    rawMessage: text,
    selfId: 'bot-1',
    targetId: 'group-1',
    userId: 'user-1',
  };
}

function createService(config: Record<string, number | string | undefined>) {
  const sendService = {
    sendText: jest.fn().mockResolvedValue({ status: 'ok' }),
  };
  const service = createPlugin({
    host: {
      bindEventPlugin: jest.fn(),
      getBoundEventPluginKeys: jest.fn().mockResolvedValue(['repeater']),
      getConfig: (<T = string>(key: string) => config[key] as T),
      sendText: sendService.sendText,
      unbindEventPlugin: jest.fn(),
      warn: jest.fn(),
    },
    manifest: {
      events: [],
      name: '复读机',
      pluginKey: 'repeater',
      version: '1.0.0',
    },
    now: () => Date.now(),
  });
  return { sendService, service };
}

describe('RepeaterPluginService risk-control defaults', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-12T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses a conservative default threshold before repeating', async () => {
    const { sendService, service } = createService({});

    await service.handleMessage(createMessage('哈'));
    await service.handleMessage(createMessage('哈'));
    await service.handleMessage(createMessage('哈'));

    expect(sendService.sendText).not.toHaveBeenCalled();

    await service.handleMessage(createMessage('哈'));

    expect(sendService.sendText).toHaveBeenCalledTimes(1);
  });

  it('applies a conversation interval after one repeated send', async () => {
    const { sendService, service } = createService({
      QQBOT_REPEATER_CONFIG_CACHE_TTL_MS: 600000,
      QQBOT_REPEATER_MIN_INTERVAL_MS: 600000,
      QQBOT_REPEATER_THRESHOLD: 4,
    });

    for (let index = 0; index < 4; index += 1) {
      await service.handleMessage(createMessage('哈'));
    }
    for (let index = 0; index < 4; index += 1) {
      await service.handleMessage(createMessage('呀'));
    }

    expect(sendService.sendText).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(Date.now() + 600000));
    await service.handleMessage(createMessage('呀'));

    expect(sendService.sendText).toHaveBeenCalledTimes(2);
  });

  it('applies the conversation interval even when repeated send fails', async () => {
    const { sendService, service } = createService({
      QQBOT_REPEATER_CONFIG_CACHE_TTL_MS: 600000,
      QQBOT_REPEATER_MIN_INTERVAL_MS: 600000,
      QQBOT_REPEATER_THRESHOLD: 4,
    });
    sendService.sendText.mockRejectedValueOnce(new Error('send failed'));

    for (let index = 0; index < 4; index += 1) {
      await service.handleMessage(createMessage('哈'));
    }
    for (let index = 0; index < 4; index += 1) {
      await service.handleMessage(createMessage('呀'));
    }

    expect(sendService.sendText).toHaveBeenCalledTimes(1);
  });

  it('keeps the conversation interval after a non-repeatable message', async () => {
    const { sendService, service } = createService({
      QQBOT_REPEATER_CONFIG_CACHE_TTL_MS: 600000,
      QQBOT_REPEATER_MIN_INTERVAL_MS: 600000,
      QQBOT_REPEATER_THRESHOLD: 4,
    });

    for (let index = 0; index < 4; index += 1) {
      await service.handleMessage(createMessage('哈'));
    }

    await service.handleMessage(createMessage('!help'));

    for (let index = 0; index < 4; index += 1) {
      await service.handleMessage(createMessage('呀'));
    }

    expect(sendService.sendText).toHaveBeenCalledTimes(1);
  });
});
