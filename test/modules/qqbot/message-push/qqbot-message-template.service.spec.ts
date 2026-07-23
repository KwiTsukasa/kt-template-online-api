import type { Repository } from 'typeorm';
import { KtDateTime } from '../../../../src/common';
import { SystemMessageTemplateRendererService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-template-renderer.service';
import { QqbotMessageTemplateService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-message-template.service';
import { SystemMessageSourceRegistry } from '../../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessageTemplate } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-template.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const NOW = new Date('2026-07-24T00:00:00.000Z');

/** Creates an in-memory template fixture with explicit serializable timestamps. */
function template(
  overrides: Partial<QqbotMessageTemplate> = {},
): QqbotMessageTemplate {
  return {
    content: '端口 ${{port}}，就绪：${{ready}}',
    createId: jest.fn(),
    createTime: NOW as never,
    enabled: true,
    id: '100',
    isDeleted: false,
    name: '端口提醒',
    remark: null,
    sourceKey: SOURCE_KEY,
    updateTime: NOW as never,
    ...overrides,
  };
}

/** Registers the source definition used by template lifecycle tests. */
function registry(): SystemMessageSourceRegistry {
  const value = new SystemMessageSourceRegistry();
  value.register({
    definition: {
      description: 'STUN 映射端口变化',
      displayName: 'STUN 端口变化',
      sourceKey: SOURCE_KEY,
      subscriptionFields: [],
      variables: [
        {
          description: '端口',
          example: '38213',
          key: 'port',
          label: '端口',
          type: 'number',
        },
        {
          description: '就绪',
          example: 'true',
          key: 'ready',
          label: '就绪',
          type: 'boolean',
        },
        {
          description: '地址',
          example: 'pal.example.com',
          key: 'endpoint',
          label: '地址',
          type: 'string',
        },
      ],
      version: 1,
    },
    inspectSubscription: jest.fn(),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(),
    resolveDelivery: jest.fn(),
    validateEventPayload: jest.fn(),
  });
  return value;
}

/** Constructs a template service with narrow repository fakes for unit-level lifecycle checks. */
function setup(items: QqbotMessageTemplate[] = [template()]) {
  const templateRepository = {
    create: jest.fn((input) => template(input)),
    findAndCount: jest.fn().mockResolvedValue([items, items.length]),
    findOne: jest.fn(
      async ({ where: { id } }) =>
        items.find((item) => item.id === id && !item.isDeleted) ?? null,
    ),
    save: jest.fn(async (item) => item),
  } as unknown as jest.Mocked<Repository<QqbotMessageTemplate>>;
  const bindingRepository = {
    count: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<Repository<QqbotMessagePublishBinding>>;
  const service = new QqbotMessageTemplateService(
    templateRepository,
    bindingRepository,
    registry(),
    new SystemMessageTemplateRendererService(),
  );
  return { bindingRepository, service, templateRepository };
}

describe('QqbotMessageTemplateService', () => {
  it('pages undeleted templates with filters, source names, and every live binding reference', async () => {
    const { bindingRepository, service, templateRepository } = setup([
      template({ id: '100' }),
      template({ id: '101', name: '另一模板' }),
    ]);
    bindingRepository.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    await expect(
      service.page({
        enabled: true,
        name: '端口',
        pageNo: 2,
        pageSize: 10,
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: '100',
          referenceCount: 2,
          sourceName: 'STUN 端口变化',
        }),
        expect.objectContaining({
          id: '101',
          referenceCount: 1,
          sourceName: 'STUN 端口变化',
        }),
      ],
      total: 2,
    });
    expect(templateRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(bindingRepository.count).toHaveBeenNthCalledWith(1, {
      where: { isDeleted: false, templateId: '100' },
    });
  });

  it('serializes KtDateTime through the project formatter rather than UTC ISO text', async () => {
    const dateTime = new KtDateTime('2026-07-24 08:09:10');
    const { service } = setup([
      template({ createTime: dateTime, updateTime: dateTime }),
    ]);

    await expect(service.page({})).resolves.toEqual({
      items: [
        expect.objectContaining({
          createTime: String(dateTime),
          updateTime: String(dateTime),
        }),
      ],
      total: 1,
    });
  });

  it('creates and updates only templates valid for the current source variable definition', async () => {
    const { service, templateRepository } = setup();
    const input = {
      content: '地址 ${{endpoint}}',
      enabled: true,
      name: '新模板',
      remark: '  说明  ',
      sourceKey: SOURCE_KEY,
    };

    await expect(service.create(input)).resolves.toEqual(
      expect.objectContaining({ name: '新模板', remark: '说明' }),
    );
    await expect(
      service.update('100', { ...input, content: '端口 ${{port}}' }),
    ).resolves.toEqual(expect.objectContaining({ content: '端口 ${{port}}' }));
    await expect(
      service.create({ ...input, content: '${{unknown}}' }),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    await expect(
      service.create({ ...input, sourceKey: 'missing' }),
    ).rejects.toMatchObject({ code: 'unknown_message_source' });
    expect(templateRepository.save).toHaveBeenCalledTimes(2);
  });

  it('previews source-specific typed examples through the same renderer', () => {
    const { service } = setup();

    expect(
      service.preview({
        content: '${{port}}/${{ready}}/${{endpoint}}',
        sourceKey: SOURCE_KEY,
      }),
    ).toEqual({
      renderedMessage: '38213/true/pal.example.com',
      variables: { endpoint: 'pal.example.com', port: 38213, ready: true },
    });
  });

  it('revalidates current source contents before enabling a historical template', async () => {
    const historical = template({
      content: '${{oldVariable}}',
      enabled: false,
    });
    const { service } = setup([historical]);

    await expect(service.setEnabled('100', true)).rejects.toMatchObject({
      code: 'template_invalid',
    });
    await expect(service.setEnabled('100', false)).resolves.toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('blocks soft deletion when any non-deleted binding references the template, including disabled bindings', async () => {
    const { bindingRepository, service, templateRepository } = setup();
    bindingRepository.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.remove('100')).rejects.toMatchObject({
      code: 'template_invalid',
    });
    await expect(service.remove('100')).resolves.toBe(true);
    expect(templateRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, isDeleted: true }),
    );
  });

  it('gates publish bindings by source, deletion, enabled state, and current template validity', async () => {
    const current = template();
    const { service } = setup([current]);

    await expect(
      service.requireAvailableForBinding('100', SOURCE_KEY, true),
    ).resolves.toBe(current);
    current.enabled = false;
    await expect(
      service.requireAvailableForBinding('100', SOURCE_KEY, true),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    await expect(
      service.requireAvailableForBinding('100', SOURCE_KEY, false),
    ).resolves.toBe(current);
    await expect(
      service.requireAvailableForBinding('100', 'other.source', false),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    current.isDeleted = true;
    await expect(
      service.requireAvailableForBinding('100', SOURCE_KEY, false),
    ).rejects.toMatchObject({ code: 'template_invalid' });
  });
});
