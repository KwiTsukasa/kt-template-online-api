jest.mock('@/modules/qqbot/core/application/event/qqbot-event.service', () => ({
  QqbotEventService: class {},
}));

import { EventEmitter } from 'events';
import { ToolsService } from '@/common';
import { QqbotReverseWsService } from '@/modules/qqbot/core/infrastructure/integration/connection/qqbot-reverse-ws.service';

class FakeWebSocket extends EventEmitter {
  closed: Array<{ code?: number; reason?: string }> = [];
  readyState = 1;
  sent: string[] = [];

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
    this.readyState = 3;
    this.emit('close', code, reason);
  }

  send(payload: string) {
    this.sent.push(payload);
  }
}

function createService() {
  const accountService = {
    ensureRuntimeAccount: jest.fn(),
    findBySelfId: jest.fn(),
    findEnabledBySelfIdWithToken: jest.fn().mockResolvedValue({
      accessToken: '',
      selfId: '1914728559',
    }),
    markHeartbeat: jest.fn().mockResolvedValue(undefined),
    markOffline: jest.fn().mockResolvedValue(undefined),
    markOnline: jest.fn().mockResolvedValue(undefined),
  };
  const busService = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const service = new QqbotReverseWsService(
    {
      get: jest.fn((key: string) => {
        if (key === 'QQBOT_ENABLED') return 'true';
        if (key === 'QQBOT_API_TIMEOUT_MS') return '10';
        return '';
      }),
    } as any,
    {} as any,
    {} as any,
    accountService as any,
    busService as any,
    new ToolsService(),
  );

  return { accountService, busService, service };
}

function createRequest() {
  return {
    headers: { host: '127.0.0.1:48085' },
    url: '/onebot/v11/ws?self_id=1914728559&role=Universal',
  } as any;
}

describe('QqbotReverseWsService', () => {
  it('ignores close events from a replaced OneBot connection', async () => {
    const { accountService, busService, service } = createService();
    const oldWs = new FakeWebSocket();
    const currentWs = new FakeWebSocket();

    await (service as any).handleConnection(oldWs, createRequest());
    await (service as any).handleConnection(currentWs, createRequest());
    accountService.markOffline.mockClear();
    busService.publish.mockClear();

    oldWs.emit('close');
    await Promise.resolve();

    expect((service as any).connections.get('1914728559:Universal')).toBe(
      currentWs,
    );
    expect(accountService.markOffline).not.toHaveBeenCalled();
    expect(busService.publish).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'offline' }),
    );
  });

  it('does not mark OneBot offline when a replaced connection times out', async () => {
    const { accountService, busService, service } = createService();
    const oldWs = new FakeWebSocket();
    const currentWs = new FakeWebSocket();

    await (service as any).handleConnection(oldWs, createRequest());
    await (service as any).handleConnection(currentWs, createRequest());
    accountService.markOffline.mockClear();
    busService.publish.mockClear();

    (service as any).closeTimedOutConnection('1914728559', oldWs);
    await Promise.resolve();

    expect((service as any).connections.get('1914728559:Universal')).toBe(
      currentWs,
    );
    expect(oldWs.closed).toEqual([]);
    expect(accountService.markOffline).not.toHaveBeenCalled();
    expect(busService.publish).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'offline' }),
    );
  });

  it('marks OneBot offline when the current connection times out', async () => {
    const { accountService, busService, service } = createService();
    const ws = new FakeWebSocket();

    await (service as any).handleConnection(ws, createRequest());
    accountService.markOffline.mockClear();
    busService.publish.mockClear();

    (service as any).closeTimedOutConnection('1914728559', ws);
    await Promise.resolve();

    expect((service as any).connections.has('1914728559:Universal')).toBe(
      false,
    );
    expect(ws.closed).toEqual([
      { code: 1011, reason: 'OneBot action timeout' },
    ]);
    expect(accountService.markOffline).toHaveBeenCalledWith(
      '1914728559',
      'OneBot action timeout',
    );
    expect(busService.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        selfId: '1914728559',
        status: 'offline',
      }),
    );
  });
});
