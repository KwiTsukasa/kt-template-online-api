jest.mock(
  '@/common',
  () => ({
    ensureSnowflakeId: jest.fn(),
    /**
     * 执行 测试回调。
     */
    KtCreateDateColumn: () => () => undefined,
    KtDateTime: Date,
    /**
     * 执行 测试回调。
     */
    KtDateTimeColumn: () => () => undefined,
    /**
     * 执行 测试回调。
     */
    KtDateTimeField: () => () => undefined,
    /**
     * 执行 测试回调。
     */
    KtUpdateDateColumn: () => () => undefined,
    /**
     * 执行 测试回调。
     * @param value - 待转换时间值；构造时间对象。
     */
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
    /**
     * 执行 测试回调。
     * @param value - 待转换时间值；影响 transformKtDateTimeFields 的返回值。
     */
    transformKtDateTimeFields: (value: unknown) => value,
  }),
  { virtual: true },
);

import type { QqbotCommand } from '@/modules/qqbot/core/infrastructure/persistence/command/qqbot-command.entity';
import { QqbotCommandParserService } from '@/modules/qqbot/core/application/command/qqbot-command-parser.service';

describe('QqbotCommandParserService', () => {
  const command = {
    aliases: '["logs"]',
    code: 'fflogs_character',
    name: 'FFLogs 查询',
    parserKey: 'fflogsCharacter',
    prefixes: '["/"]',
  } as QqbotCommand;

  const service = new QqbotCommandParserService();

  it('matches aliases and returns raw arguments for plugin-platform parsing', async () => {
    const matched = await service.match(command, {
      messageText: '/logs Kwi柊司 琥珀原 上位护锁刃龙',
    } as any);

    expect(matched).toEqual({
      alias: 'logs',
      input: {
        args: ['Kwi柊司', '琥珀原', '上位护锁刃龙'],
        raw: 'Kwi柊司 琥珀原 上位护锁刃龙',
        text: 'Kwi柊司 琥珀原 上位护锁刃龙',
      },
      matched: true,
      rawArgs: 'Kwi柊司 琥珀原 上位护锁刃龙',
    });
  });

  it('returns null when the command prefix or alias does not match', async () => {
    await expect(
      service.match(command, {
        messageText: 'logs Kwi柊司 琥珀原',
      } as any),
    ).resolves.toBeNull();
  });
});
