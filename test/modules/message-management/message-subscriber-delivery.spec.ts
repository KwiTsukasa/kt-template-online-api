import { StationNoticeMessageSubscriberAdapter } from '@/modules/admin/platform-config/notice/station-notice-message-subscriber.adapter';
import { StationNoticeMessageBinding } from '@/modules/admin/platform-config/notice/station-notice-message-binding.entity';
import type { MessageSubscriberInput } from '@/modules/message-management/application/subscriber/message-subscriber.adapter';
import { QqbotAccount } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import { QqbotMessageSubscriberAdapter } from '@/modules/qqbot/message-management-adapter/qqbot-message-subscriber.adapter';
import { QqbotMessageDelivery } from '@/modules/qqbot/message-management-adapter/qqbot-message-delivery.entity';
import { QqbotMessagePublishBinding } from '@/modules/qqbot/message-management-adapter/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '@/modules/qqbot/message-management-adapter/qqbot-message-publish-target.entity';

const unifiedInput: Extract<MessageSubscriberInput, { lifecycle: 'deliver' }> =
  {
    lifecycle: 'deliver',
    manager: null as never,
    message: {
      eventId: 'event-1',
      messageEventId: '100',
      occurredAt: new Date('2026-08-18T00:00:00.000Z'),
      resourceKey: 'resource-1',
      sourceKey: 'source-1',
      subscriberKey: 'qqbot',
      subscriptionId: '200',
      supersededMessageEventIds: [],
      templates: [
        {
          renderedMessage: 'message-a',
          sortOrder: 0,
          templateContent: '{{value}}-a',
          templateId: '301',
          templateName: 'template-a',
        },
        {
          renderedMessage: 'message-b',
          sortOrder: 1,
          templateContent: '{{value}}-b',
          templateId: '302',
          templateName: 'template-b',
        },
      ],
      variables: { value: 'message' },
    },
    now: new Date('2026-08-18T00:00:01.000Z'),
  };

describe('message subscriber delivery', () => {
  it('lets QQBot create one private delivery per rendered template and target', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const deliveryRepository = {
      create: jest.fn((value) => value),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (value) => {
        saved.push(value);
        return value;
      }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === QqbotMessagePublishBinding) {
          return {
            find: jest.fn().mockResolvedValue([
              {
                accountId: '10',
                enabled: true,
                id: '20',
                isDeleted: false,
                selfId: '12345',
                subscriptionId: '200',
              },
            ]),
          };
        }
        if (entity === QqbotAccount) {
          return {
            find: jest.fn().mockResolvedValue([
              {
                enabled: true,
                id: '10',
                isDeleted: false,
                selfId: '12345',
              },
            ]),
          };
        }
        if (entity === QqbotMessagePublishTarget) {
          return {
            find: jest.fn().mockResolvedValue([
              {
                bindingId: '20',
                enabled: true,
                id: '30',
                isDeleted: false,
                targetId: '54321',
                targetType: 'group',
              },
            ]),
          };
        }
        if (entity === QqbotMessageDelivery) return deliveryRepository;
        throw new Error('unexpected repository');
      }),
    };
    const adapter = new QqbotMessageSubscriberAdapter(
      {} as never,
      {} as never,
      {} as never,
    );

    await adapter.receive({ ...unifiedInput, manager: manager as never });

    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.templateId)).toEqual(['301', '302']);
    expect(saved.map((item) => item.renderedMessage)).toEqual([
      'message-a',
      'message-b',
    ]);
  });

  it('lets station notice persist every rendered template independently', async () => {
    const publishMessageSubscriberNotice = jest
      .fn()
      .mockResolvedValue(undefined);
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity !== StationNoticeMessageBinding) {
          throw new Error('unexpected repository');
        }
        return {
          find: jest.fn().mockResolvedValue([
            {
              enabled: true,
              id: '40',
              isDeleted: false,
              notifyRoleCode: 'admin',
              subscriptionId: '200',
              title: 'title',
            },
          ]),
        };
      }),
    };
    const adapter = new StationNoticeMessageSubscriberAdapter(
      {} as never,
      { publishMessageSubscriberNotice } as never,
      { publishCommitted: jest.fn() } as never,
    );

    const receipt = await adapter.receive({
      ...unifiedInput,
      manager: manager as never,
    });

    expect(publishMessageSubscriberNotice).toHaveBeenCalledTimes(2);
    expect(
      publishMessageSubscriberNotice.mock.calls.map((call) => call[1].content),
    ).toEqual(['message-a', 'message-b']);
    expect(receipt).toEqual(
      expect.objectContaining({ afterCommit: expect.any(Function) }),
    );
  });

  it('lets station notice publish realtime changes only after commit', async () => {
    const publishCommitted = jest.fn();
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([
          {
            enabled: true,
            id: '40',
            isDeleted: false,
            notifyRoleCode: 'admin',
            subscriptionId: '200',
            title: 'title',
          },
        ]),
      }),
    };
    const adapter = new StationNoticeMessageSubscriberAdapter(
      {} as never,
      { publishMessageSubscriberNotice: jest.fn() } as never,
      { publishCommitted } as never,
    );

    const receipt = await adapter.receive({
      ...unifiedInput,
      manager: manager as never,
    });

    expect(publishCommitted).not.toHaveBeenCalled();
    if (!receipt) throw new Error('station notice receipt is missing');
    await receipt.afterCommit?.();
    expect(publishCommitted).toHaveBeenCalledTimes(1);
    expect(publishCommitted).toHaveBeenCalledWith('created');
  });
});
