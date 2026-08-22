import type { BotPluginMessageEvent } from '@/modules/plugin-platform/contract/plugin-protocol';
import { RepeaterApplication } from '@/modules/plugins/repeater/src/application/repeater-application';
import type { RepeaterPluginHost } from '@/modules/plugins/repeater/src/infrastructure/integration/repeater-host';

describe('repeater protocol plugin', () => {
  const host: RepeaterPluginHost = {
    getConfig: <T = string>(key: string) => {
      const values: Record<string, string> = {
        PLUGIN_REPEATER_MAX_TEXT_LENGTH: '120',
        PLUGIN_REPEATER_MIN_INTERVAL_MS: '1',
        PLUGIN_REPEATER_STATE_TTL_MS: '600000',
        PLUGIN_REPEATER_THRESHOLD: '3',
      };
      return values[key] as T | undefined;
    },
  };
  const manifest = {
    description: 'repeat',
    events: [],
    name: 'Repeater',
    pluginKey: 'repeater',
    version: '1.0.0',
  };

  it('returns a text reply intent after the configured threshold', async () => {
    const application = new RepeaterApplication(host, manifest, () => 1_000_000);
    await expect(application.handleMessage(createEvent())).resolves.toEqual({
      handled: false,
      replies: [],
    });
    await expect(application.handleMessage(createEvent())).resolves.toEqual({
      handled: false,
      replies: [],
    });
    await expect(application.handleMessage(createEvent())).resolves.toEqual({
      handled: true,
      replies: [{ content: 'hello', kind: 'text' }],
    });
  });

  it('isolates state by opaque conversation key and ignores self events', async () => {
    const application = new RepeaterApplication(host, manifest, () => 1_000_000);
    await application.handleMessage(createEvent());
    await application.handleMessage(createEvent({ conversationKey: 'other' }));
    await expect(
      application.handleMessage(createEvent({ isSelf: true })),
    ).resolves.toEqual({ handled: false, replies: [] });
  });
});

/**
 * 构造复读插件使用的平台无关事件。
 * @param patch - 需要覆盖的事件字段。
 * @returns 标准消息事件。
 */
function createEvent(
  patch: Partial<BotPluginMessageEvent> = {},
): BotPluginMessageEvent {
  return {
    conversationKey: 'conversation',
    eventId: 'event',
    isSelf: false,
    links: [],
    metadata: {},
    rawText: 'hello',
    scope: 'group',
    senderKey: 'sender',
    text: 'hello',
    ...patch,
  };
}
