import { createPlugin } from '@/modules/plugins/hermes-agent/src';

const event = {
  conversationKey: 'conversation',
  eventId: 'message',
  isSelf: false,
  links: [],
  metadata: {},
  rawText: '你好',
  scope: 'direct',
  senderKey: 'sender',
  text: '你好',
};
const manifest = {
  pluginKey: 'hermes-agent',
  name: 'Hermes Agent',
  version: '1.0.0',
};
const makePlugin = (requestJson: jest.Mock, installationId = 'installation') =>
  createPlugin({
    host: { requestJson, warn: jest.fn() },
    manifest,
    runtime: {
      installationId,
      configSnapshot: {
        HERMES_AGENT_BASE_URL: 'http://127.0.0.1:8642/v1',
        HERMES_AGENT_API_KEY: 'test-key',
      },
    },
  });

describe('Hermes Agent message integration', () => {
  it('leaves self messages and commands to the host without an inference request', async () => {
    const request = jest.fn();
    const plugin = makePlugin(request);
    for (const patch of [
      { isSelf: true },
      { text: '/natmap WireGuard' },
      { text: '   ' },
      { text: '[CQ:image]' },
    ]) {
      expect(
        await plugin.handleEvent('message', { ...event, ...patch }),
      ).toEqual({ handled: false, replies: [] });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves one sender history but separates conversations, senders, and installations', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({
        choices: [{ finish_reason: 'stop', message: { content: '你好呀' } }],
      });
    const plugin = makePlugin(request);
    expect(await plugin.handleEvent('message', event)).toEqual({
      handled: true,
      replies: [{ kind: 'text', content: '你好呀' }],
    });
    await plugin.handleEvent('message', { ...event, eventId: 'next' });
    await plugin.handleEvent('message', { ...event, conversationKey: 'other' });
    await plugin.handleEvent('message', { ...event, senderKey: 'another' });
    await makePlugin(request, 'different-installation').handleEvent(
      'message',
      event,
    );
    const keys = request.mock.calls.map(
      ([input]) => input.headers['X-Hermes-Session-Id'],
    );
    expect(keys[0]).toEqual(keys[1]);
    expect(new Set(keys).size).toBe(4);
    const input = request.mock.calls[0][0];
    expect(input.headers['X-Hermes-Session-Key']).toBeUndefined();
    expect(input.headers['Idempotency-Key']).not.toBe(
      request.mock.calls[1][0].headers['Idempotency-Key'],
    );
    expect(JSON.parse(input.body)).toMatchObject({
      model: 'kwitsukasa',
      messages: [
        { role: 'system', content: expect.stringContaining('长期记忆共享') },
        { role: 'user', content: '你好' },
      ],
      stream: false,
    });
  });

  it('queues concurrent turns and releases the session after provider failure', async () => {
    let fail: (error: Error) => void = () => undefined;
    const request = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue({
        choices: [{ finish_reason: 'stop', message: { content: '恢复了' } }],
      });
    const plugin = makePlugin(request);
    const first = plugin.handleEvent('message', event);
    const second = plugin.handleEvent('message', { ...event, eventId: 'next' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(request).toHaveBeenCalledTimes(1);
    fail(new Error('private upstream response test-key'));
    const failure = await first;
    expect(JSON.stringify(failure)).not.toContain('test-key');
    expect(await second).toEqual({
      handled: true,
      replies: [{ kind: 'text', content: '恢复了' }],
    });
  });

  it('rejects empty or embedded provider errors and splits complete replies without losing emoji', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: 'HTTP 400: secret configuration' },
          },
        ],
      })
      .mockResolvedValueOnce({ choices: [] })
      .mockResolvedValueOnce({
        choices: [
          { finish_reason: 'stop', message: { content: '😀'.repeat(1900) } },
        ],
      });
    const plugin = makePlugin(request);
    expect(
      JSON.stringify(await plugin.handleEvent('message', event)),
    ).not.toContain('secret configuration');
    expect(await plugin.handleEvent('message', event)).toMatchObject({
      handled: true,
    });
    const result = await plugin.handleEvent('message', event);
    expect(Array.from(result.replies[0].content)).toHaveLength(1800);
    expect(result.replies).toHaveLength(2);
    expect(result.replies.map((part) => part.content).join('')).toBe(
      '😀'.repeat(1900),
    );
  });

  it('does not present partial or failed agent runs as successful replies', async () => {
    for (const response of [
      {
        choices: [
          {
            finish_reason: 'length',
            message: { content: 'unfinished content' },
          },
        ],
      },
      {
        choices: [
          { finish_reason: 'error', message: { content: 'upstream secret' } },
        ],
      },
      {
        choices: [
          { finish_reason: 'stop', message: { content: 'unfinished content' } },
        ],
        hermes: { partial: true },
      },
    ]) {
      const result = await makePlugin(
        jest.fn().mockResolvedValue(response),
      ).handleEvent('message', event);
      expect(result.replies[0].content).toBe('这次没能生成回复，请稍后再试。');
    }
  });

  it('makes budget truncation explicit and obeys direct and group reply limits', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({
        choices: [
          { finish_reason: 'stop', message: { content: '文'.repeat(12000) } },
        ],
      });
    const plugin = makePlugin(request);
    const direct = await plugin.handleEvent('message', event);
    const group = await plugin.handleEvent('message', {
      ...event,
      scope: 'group',
    });
    expect(direct.replies).toHaveLength(4);
    expect(group.replies).toHaveLength(5);
    expect(direct.replies[3].content).toContain('后续内容未发送');
    expect(group.replies[4].content).toContain('后续内容未发送');
  });

  it('expires a queued wait without letting a later turn overtake the running turn', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      let finish: (value: unknown) => void = () => undefined;
      const response = {
        choices: [{ finish_reason: 'stop', message: { content: '完成' } }],
      };
      const request = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue(response);
      const plugin = makePlugin(request);
      const first = plugin.handleEvent('message', event);
      await new Promise((resolve) => setImmediate(resolve));
      const expired = plugin.handleEvent('message', {
        ...event,
        eventId: 'expired',
      });
      jest.advanceTimersByTime(15000);
      await new Promise((resolve) => setImmediate(resolve));
      expect((await expired).replies[0].content).toContain('请稍后再发这条');
      const third = plugin.handleEvent('message', {
        ...event,
        eventId: 'third',
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(request).toHaveBeenCalledTimes(1);
      finish(response);
      await first;
      await third;
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
