import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(__dirname, '../../..');
const CHANNEL_ROOTS = [
  'src/modules/bot-adapter/message-management',
  'src/modules/admin/platform-config/notice',
];

/**
 * 递归收集指定源码目录下的 TypeScript 文件，供协议依赖边界测试逐文件检查。
 * @param relativeRoot - 相对于 API 项目根目录的源码目录。
 * @returns 目录下全部 TypeScript 文件的绝对路径。
 */
function typescriptFiles(relativeRoot: string): string[] {
  const absoluteRoot = resolve(PROJECT_ROOT, relativeRoot);
  return readdirSync(absoluteRoot, { recursive: true }).flatMap((entry) => {
    if (typeof entry !== 'string' || !entry.endsWith('.ts')) return [];
    return [resolve(absoluteRoot, entry)];
  });
}

describe('message protocol dependency boundary', () => {
  it('keeps Bot and station notice adapters behind the unified message protocol', () => {
    const forbidden =
      /SystemMessageSource(?:Adapter|Registry)|resolveDelivery|validateEventPayload|inspectSubscription|waiting_ddns|network\.ddns/;

    for (const root of CHANNEL_ROOTS) {
      for (const file of typescriptFiles(root)) {
        expect(readFileSync(file, 'utf8')).not.toMatch(forbidden);
      }
    }
  });

  it('keeps the message core independent from concrete subscriber modules', () => {
    for (const file of typescriptFiles('src/modules/message-management')) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/modules\/qqbot/);
      expect(source).not.toMatch(/platform-config\/notice/);
    }
  });

  it('exposes a normalized envelope instead of source readiness to channels', () => {
    const contract = readFileSync(
      resolve(
        PROJECT_ROOT,
        'src/modules/message-management/application/subscriber/message-subscriber.adapter.ts',
      ),
      'utf8',
    );
    expect(contract).toContain('UnifiedMessageEnvelope');
    expect(contract).toContain('renderedMessage: string');
    expect(contract).toContain('subscriberKey: string');
    expect(contract).toContain('subscriptionId: string');
    expect(contract).toContain('templates: UnifiedMessageTemplate[]');
    expect(contract).toContain('supersededMessageEventIds: string[]');
    expect(contract).not.toContain('MessageSubscription');
    expect(contract).not.toContain('SystemMessageDeliveryReadiness');
    expect(contract).not.toContain('notifyDependencyChanged');
  });

  it('binds source to templates and multiple templates plus subscriber to subscription', () => {
    const templateEntity = readFileSync(
      resolve(
        PROJECT_ROOT,
        'src/modules/message-management/infrastructure/persistence/message-template.entity.ts',
      ),
      'utf8',
    );
    const subscriptionEntity = readFileSync(
      resolve(
        PROJECT_ROOT,
        'src/modules/message-management/infrastructure/persistence/message-subscription.entity.ts',
      ),
      'utf8',
    );
    const subscriptionTemplateEntity = readFileSync(
      resolve(
        PROJECT_ROOT,
        'src/modules/message-management/infrastructure/persistence/message-subscription-template.entity.ts',
      ),
      'utf8',
    );
    expect(templateEntity).toContain("name: 'source_key'");
    expect(subscriptionEntity).toContain("name: 'subscriber_key'");
    expect(subscriptionEntity).not.toContain("name: 'source_key'");
    expect(subscriptionEntity).not.toContain("name: 'template_id'");
    expect(subscriptionTemplateEntity).toContain("name: 'subscription_id'");
    expect(subscriptionTemplateEntity).toContain("name: 'template_id'");
  });

  it('keeps templates out of subscriber-private bindings', () => {
    const bindingFiles = [
      'src/modules/bot-adapter/message-management/bot-message-publish-binding.entity.ts',
      'src/modules/admin/platform-config/notice/station-notice-message-binding.entity.ts',
    ];
    for (const file of bindingFiles) {
      expect(readFileSync(resolve(PROJECT_ROOT, file), 'utf8')).not.toContain(
        "name: 'template_id'",
      );
    }
  });

  it('routes each subscription only to its declared subscriber', () => {
    const fanout = readFileSync(
      resolve(
        PROJECT_ROOT,
        'src/modules/message-management/application/system-message-fanout.service.ts',
      ),
      'utf8',
    );
    expect(fanout).toContain('subscription.subscriberKey');
    expect(fanout).not.toContain('requireChannels()');
  });
});
