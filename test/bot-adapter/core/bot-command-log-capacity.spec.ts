import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { BotCommandLog } from '@/modules/bot-adapter/core/infrastructure/persistence/command/bot-command-log.entity';

describe('分页命令日志容量', () => {
  it.each(['input', 'output'])(
    '实体、初始化及升级保留 %s 的宽列合同',
    (field) => {
      const column = getMetadataArgsStorage().columns.find(
        (item) => item.target === BotCommandLog && item.propertyName === field,
      );
      expect(column?.options.type).toBe('longtext');
      const init = readFileSync(resolve('sql/bot-init.sql'), 'utf8');
      const upgrade = readFileSync(
        resolve('sql/bot-command-log-output-capacity.sql'),
        'utf8',
      );
      const table = init
        .split('CREATE TABLE IF NOT EXISTS `bot_command_log`')[1]
        .split('ENGINE=')[0];
      expect(table).toMatch(new RegExp('`' + field + '` longtext', 'i'));
      expect(upgrade).toMatch(
        new RegExp('MODIFY COLUMN `' + field + '` LONGTEXT NULL', 'i'),
      );
    },
  );
});
