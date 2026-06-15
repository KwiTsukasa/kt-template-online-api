jest.mock(
  '@/common',
  () => ({
    ensureSnowflakeId: jest.fn(),
    KtCreateDateColumn: () => () => undefined,
    KtDateTime: Date,
    KtDateTimeColumn: () => () => undefined,
    KtDateTimeField: () => () => undefined,
    KtUpdateDateColumn: () => () => undefined,
    formatKtDateTime: (value: Date | number | string) => {
      const date = value instanceof Date ? value : new Date(value);
      return [
        `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(
          2,
          '0',
        )}-${`${date.getDate()}`.padStart(2, '0')}`,
        `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(
          2,
          '0',
        )}:${`${date.getSeconds()}`.padStart(2, '0')}`,
      ].join(' ');
    },
    setDictDecodeCache: jest.fn(),
    transformKtDateTimeFields: (value: unknown) => value,
  }),
  { virtual: true },
);

import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import type { QqbotCommand } from '@/modules/qqbot/core/command/qqbot-command.entity';
import { QqbotCommandParserService } from '@/modules/qqbot/core/command/qqbot-command-parser.service';

describe('QqbotCommandParserService FFLogs parser', () => {
  const command = {
    aliases: '["logs"]',
    code: 'fflogs_character',
    name: 'FFLogs 查询',
    parserKey: 'fflogsCharacter',
    prefixes: '["/"]',
  } as QqbotCommand;

  const dictService = {
    getDictItemsByKey: jest.fn(async () => []),
    relationTree: jest.fn(async () => [
      {
        children: [
          {
            children: [
              {
                dictCode: 'FF14_MARKET_WORLD_CN_MAOXIAOPANG',
                label: '琥珀原',
                treeKey: 'world-1',
                value: '琥珀原',
              },
            ],
            dictCode: 'FF14_MARKET_DATA_CENTER_CN',
            label: '猫小胖',
            treeKey: 'dc-1',
            value: '猫小胖',
          },
        ],
        dictCode: 'FF14_MARKET_REGION',
        label: '中国',
        treeKey: 'region-1',
        value: '中国',
      },
    ]),
  } as unknown as DictService;

  const service = new QqbotCommandParserService(dictService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses Chinese encounter name after character and server without encounter dict', async () => {
    const matched = await service.match(command, {
      messageText: '/logs Kwi柊司 琥珀原 上位护锁刃龙',
    } as any);

    expect(matched?.input).toMatchObject({
      characterName: 'Kwi柊司',
      encounterName: '上位护锁刃龙',
      serverSlug: '琥珀原',
    });
    expect(dictService.getDictItemsByKey).not.toHaveBeenCalled();
  });

  it('keeps character summary parsing when no encounter is provided', async () => {
    const matched = await service.match(command, {
      messageText: '/logs Kwi柊司 琥珀原',
    } as any);

    expect(matched?.input).toMatchObject({
      characterName: 'Kwi柊司',
      serverSlug: '琥珀原',
    });
    expect((matched?.input as any).encounterName).toBe('');
  });
});
