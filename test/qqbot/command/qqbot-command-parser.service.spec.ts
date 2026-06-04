jest.mock(
  '@/common',
  () => ({
    ensureSnowflakeId: jest.fn(),
    FormatDateTime: () => () => undefined,
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
  }),
  { virtual: true },
);

import { DictService } from '@/admin/dict/dict.service';
import type { QqbotCommand } from '@/qqbot/command/qqbot-command.entity';
import { QqbotCommandParserService } from '@/qqbot/command/qqbot-command-parser.service';

describe('QqbotCommandParserService FFLogs parser', () => {
  const command = {
    aliases: '["logs"]',
    code: 'fflogs_character',
    name: 'FFLogs 查询',
    parserKey: 'fflogsCharacter',
    prefixes: '["/"]',
  } as QqbotCommand;

  const dictService = {
    getDictItemsByKey: jest.fn(async (dictKey: string) => {
      if (dictKey === 'FFLOGS_ENCOUNTER_LABEL') {
        return [
          { label: 'M9S 吸血鬼偶像', value: 'vampfatale' },
          { label: 'M10S Red Hot and Deep Blue', value: 'redhotanddeepblue' },
        ];
      }
      return [];
    }),
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

  it('parses Chinese encounter name after character and server', async () => {
    const matched = await service.match(command, {
      messageText: '/logs Anbbo 琥珀原 吸血鬼偶像',
    } as any);

    expect(matched?.input).toMatchObject({
      characterName: 'Anbbo',
      encounterName: '吸血鬼偶像',
      serverSlug: '琥珀原',
    });
  });

  it('parses space separated encounter name when server is explicit', async () => {
    const matched = await service.match(command, {
      messageText: '/logs Kwi 柊司 M10S Red Hot and Deep Blue server=琥珀原',
    } as any);

    expect(matched?.input).toMatchObject({
      characterName: 'Kwi 柊司',
      encounterName: 'M10S Red Hot and Deep Blue',
      serverSlug: '琥珀原',
    });
  });
});
