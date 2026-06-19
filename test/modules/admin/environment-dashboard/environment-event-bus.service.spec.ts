import * as mqtt from 'mqtt';
import { EnvironmentEventBusService } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/event/environment-event-bus.service';

jest.mock('mqtt', () => ({
  connect: jest.fn(),
}));

describe('environment event bus service', () => {
  it('publishes local events to in-process subscribers', async () => {
    const bus = new EnvironmentEventBusService({ mode: 'local' });
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      received.push(event.eventId);
    });

    await bus.publish({
      eventId: 'evt-local-1',
      observedAt: '2026-06-18T01:00:00.000Z',
      severity: 'ok',
      siteId: 'local-dev',
      sourceKind: 'local',
      summary: 'local ready',
      topic: 'kt/env/event/local-dev/api/runtime',
    });

    unsubscribe();
    expect(received).toEqual(['evt-local-1']);
  });

  it('subscribes only to the environment prefix in mqtt mode and emits broker disconnect evidence', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const client = {
      end: jest.fn(),
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
        return client;
      }),
      publish: jest.fn(),
      subscribe: jest.fn(),
    };
    (mqtt.connect as jest.Mock).mockReturnValue(client);

    const bus = new EnvironmentEventBusService({
      clientId: 'test-client',
      mode: 'mqtt',
      topicPrefix: 'kt/env',
      url: 'mqtt://broker.test',
    });
    const received: string[] = [];
    bus.subscribe((event) => {
      received.push(`${event.severity}:${event.summary}`);
    });
    await bus.onModuleInit();
    handlers.close();

    expect(client.subscribe).toHaveBeenCalledWith('kt/env/#');
    expect(received).toContain('unknown:MQTT broker disconnected');
  });
});
