import { MessageSubscriberRegistry } from '../../../../src/modules/message-management/application/subscriber/message-subscriber.registry';
import { SystemMessageDeliveryCoordinatorService } from '../../../../src/modules/message-management/application/system-message-delivery-coordinator.service';
import { SYSTEM_MESSAGE_BATCH_SIZE } from '../../../../src/modules/message-management/application/system-message-runner.constants';

const subscriber = (
  subscriberKey: string,
  runOnce: jest.Mock<Promise<number>, [Date]>,
) => ({
  cancelSubscriptionDeliveries: jest.fn(),
  definition: {
    description: `${subscriberKey} 测试订阅者`,
    displayName: subscriberKey,
    subscriberKey,
    version: 1 as const,
  },
  hasSubscriptionReferences: jest.fn(),
  receive: jest.fn(),
  runOnce,
});

const createFixture = () => {
  const qqbotRunOnce = jest.fn<Promise<number>, [Date]>().mockResolvedValue(0);
  const stationRunOnce = jest
    .fn<Promise<number>, [Date]>()
    .mockResolvedValue(0);
  const registry = new MessageSubscriberRegistry();
  registry.register(subscriber('qqbot', qqbotRunOnce));
  registry.register(subscriber('station-notice', stationRunOnce));
  const fanout = {
    runOnce: jest.fn().mockResolvedValue(0),
    wakeDeferred: jest.fn().mockResolvedValue(0),
  };
  const coordinator = new SystemMessageDeliveryCoordinatorService(
    fanout as never,
    registry,
  );
  return { coordinator, fanout, qqbotRunOnce, stationRunOnce };
};

describe('SystemMessageDeliveryCoordinatorService', () => {
  it('drains message management first and then every registered subscriber runner', async () => {
    const fixture = createFixture();
    const order: string[] = [];
    fixture.fanout.runOnce.mockImplementation(async () => {
      order.push('message-management');
      return 0;
    });
    fixture.qqbotRunOnce.mockImplementation(async () => {
      order.push('qqbot');
      return 0;
    });
    fixture.stationRunOnce.mockImplementation(async () => {
      order.push('station-notice');
      return 0;
    });

    fixture.coordinator.requestDrain();
    await (fixture.coordinator as any).drainPromise;

    expect(order).toEqual(['message-management', 'qqbot', 'station-notice']);
  });

  it('repeats a drain while either core fanout or a subscriber reaches the batch limit', async () => {
    const fixture = createFixture();
    fixture.fanout.runOnce
      .mockResolvedValueOnce(SYSTEM_MESSAGE_BATCH_SIZE)
      .mockResolvedValueOnce(0);

    fixture.coordinator.requestDrain();
    await (fixture.coordinator as any).drainPromise;

    expect(fixture.fanout.runOnce).toHaveBeenCalledTimes(2);
    expect(fixture.qqbotRunOnce).toHaveBeenCalledTimes(2);
    expect(fixture.stationRunOnce).toHaveBeenCalledTimes(2);
  });

  it('wakes only deferred core events when a source dependency changes', async () => {
    const fixture = createFixture();
    fixture.fanout.wakeDeferred.mockResolvedValueOnce(2);
    const requestDrain = jest
      .spyOn(fixture.coordinator, 'requestDrain')
      .mockImplementation();

    await fixture.coordinator.notifyDependencyChanged({
      dependencyKey: 'ddns-record:9007199254740995',
      payload: { host: 'demo.example.com' },
    });

    expect(fixture.fanout.wakeDeferred).toHaveBeenCalledWith(expect.any(Date));
    expect(requestDrain).toHaveBeenCalledTimes(1);
    expect(fixture.qqbotRunOnce).not.toHaveBeenCalled();
    expect(fixture.stationRunOnce).not.toHaveBeenCalled();
  });

  it('does not wake subscribers when no deferred core event becomes runnable', async () => {
    const fixture = createFixture();
    const requestDrain = jest
      .spyOn(fixture.coordinator, 'requestDrain')
      .mockImplementation();

    await fixture.coordinator.notifyDependencyChanged({
      dependencyKey: 'ddns-record:9007199254740995',
      payload: {},
    });

    expect(requestDrain).not.toHaveBeenCalled();
  });

  it('isolates one subscriber runner failure and continues the remaining subscribers', async () => {
    const fixture = createFixture();
    fixture.qqbotRunOnce.mockRejectedValueOnce(new Error('QQ unavailable'));

    fixture.coordinator.requestDrain();
    await (fixture.coordinator as any).drainPromise;

    expect(fixture.stationRunOnce).toHaveBeenCalledTimes(1);
  });

  it('stops accepting drain and dependency notifications after module destruction', async () => {
    const fixture = createFixture();
    await fixture.coordinator.onModuleDestroy();

    fixture.coordinator.requestDrain();
    await fixture.coordinator.notifyDependencyChanged({
      dependencyKey: 'ddns-record:9007199254740995',
      payload: {},
    });

    expect(fixture.fanout.runOnce).not.toHaveBeenCalled();
    expect(fixture.fanout.wakeDeferred).not.toHaveBeenCalled();
  });
});
