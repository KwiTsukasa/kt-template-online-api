import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BotAdapterRegistry } from '../../../../src/modules/bot';

const repoRoot = join(__dirname, '../../../..');

describe('Bot protocol architecture boundary', () => {
  it('keeps Bot as a stateless adapter protocol without platform or persistence dependencies', () => {
    const files = collectTypeScriptFiles('src/modules/bot');
    expect(files.length).toBeGreaterThan(0);
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(
      /@nestjs\/typeorm|from ['"]typeorm['"]|@Entity|InjectRepository|Repository<|selfId|AppID|OpenID|OneBot|Tencent|NapCat|Qqbot|QQBot/u,
    );
  });

  it('routes only through registered protocol adapters without importing transports', async () => {
    const adapter = {
      deliver: jest.fn().mockResolvedValue({
        deliveredAt: '2026-08-22T00:00:00.000Z',
        deliveryKey: 'delivery-1',
      }),
      key: 'fixture',
      normalize: jest.fn().mockResolvedValue([]),
    };
    const registry = new BotAdapterRegistry();

    registry.register(adapter);

    expect(registry.require('fixture')).toBe(adapter);
    expect(registry.listKeys()).toEqual(['fixture']);
    expect(() => registry.register(adapter)).toThrow(
      'Bot adapter already registered: fixture',
    );
    expect(registry.unregister('fixture')).toBe(true);
    expect(() => registry.require('fixture')).toThrow(
      'Bot adapter is not registered: fixture',
    );

    const registrySource = readFileSync(
      join(repoRoot, 'src/modules/bot/registry/bot-adapter.registry.ts'),
      'utf8',
    );
    expect(registrySource).not.toMatch(
      /modules\/bot-adapter|OneBot|Tencent|NapCat|InjectRepository|Repository</u,
    );
  });

  it('keeps plugin-platform independent and moves concrete plugin packages outside it', () => {
    const files = collectTypeScriptFiles('src/modules/plugin-platform');
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(
      /modules\/bot-adapter|modules\/plugins\/|selfId|AppID|OpenID|OneBot|TencentBot|SendService/u,
    );
    expect(existsSync(join(repoRoot, 'src/modules/plugins'))).toBe(true);
  });

  it('keeps BotSendService on the registry boundary and preserves the official Tencent SDK name', () => {
    const sendSource = readFileSync(
      join(
        repoRoot,
        'src/modules/bot-adapter/core/application/send/bot-send.service.ts',
      ),
      'utf8',
    );
    expect(sendSource).toContain('BotAdapterRegistry');
    expect(sendSource).toContain('this.adapterRegistry.require(');
    expect(sendSource).toContain('adapter.deliver(');
    expect(sendSource).not.toMatch(
      /import .*BotReverseWsService|import .*TencentBotService/u,
    );

    const tencentSource = readFileSync(
      join(
        repoRoot,
        'src/modules/bot-adapter/tencent/infrastructure/tencent-bot.service.ts',
      ),
      'utf8',
    );
    expect(tencentSource).toContain("'@tencent-connect/qqbot-nodejs'");
    expect(tencentSource).toContain('new sdk.root.QQBot(');
  });

  it('uses Bot and PluginPlatform permission namespaces without QQBot compatibility codes', () => {
    const files = [
      ...collectTypeScriptFiles('src/modules/bot-adapter'),
      ...collectTypeScriptFiles('src/modules/plugin-platform'),
    ];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(source).not.toMatch(
      /QqBot:Account:(?:MessagePush|WebUI)|Bot:PluginTask:/u,
    );
    expect(source).toContain('Bot:Account:MessagePush:List');
    expect(source).toContain('Bot:Account:WebUI');
    expect(source).toContain('PluginPlatform:Plugin:List');
    expect(source).toContain('PluginPlatform:Task:List');
  });

  it('allows the qqbot name only at the official Tencent SDK package and export boundary', () => {
    const files = [
      ...collectTypeScriptFiles('src/modules/bot'),
      ...collectTypeScriptFiles('src/modules/bot-adapter'),
      ...collectTypeScriptFiles('src/modules/plugin-platform'),
      ...collectTypeScriptFiles('src/modules/plugins'),
    ];
    const violations = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split(/\r?\n/u)
        .map((line, index) => ({
          file: relative(repoRoot, file),
          line,
          lineNumber: index + 1,
        }))
        .filter(({ line }) => /qqbot/iu.test(line))
        .filter(
          ({ line }) =>
            !/@tencent-connect\/qqbot-nodejs/u.test(line) &&
            !/^\s*QQBot:\s+new\s/u.test(line) &&
            !/sdk\.root\.QQBot\(/u.test(line),
        )
        .map(
          ({ file: relativeFile, lineNumber }) =>
            `${relativeFile}:${lineNumber}`,
        ),
    );

    expect(violations).toEqual([]);
  });

  it('uses only the new top-level module directories and removes the old qqbot tree', () => {
    expect(existsSync(join(repoRoot, 'src/modules/bot'))).toBe(true);
    expect(existsSync(join(repoRoot, 'src/modules/bot-adapter/napcat'))).toBe(
      true,
    );
    expect(existsSync(join(repoRoot, 'src/modules/bot-adapter/tencent'))).toBe(
      true,
    );
    expect(existsSync(join(repoRoot, 'src/modules/plugin-platform'))).toBe(
      true,
    );
    expect(existsSync(join(repoRoot, 'src/modules/plugins'))).toBe(true);
    expect(existsSync(join(repoRoot, 'src/modules/qqbot'))).toBe(false);
  });
});

/**
 * 递归收集指定源码目录中的 TypeScript 文件。
 * @param relativeRoot - 相对仓库根的目录。
 * @returns 按相对路径排序的 TypeScript 文件绝对路径。
 */
function collectTypeScriptFiles(relativeRoot: string) {
  const root = join(repoRoot, relativeRoot);
  const files: string[] = [];
  const visit = (directory: string) => {
    readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
        return;
      }
      if (statSync(target).isFile() && target.endsWith('.ts')) {
        files.push(target);
      }
    });
  };
  visit(root);
  return files.sort((left, right) =>
    relative(repoRoot, left).localeCompare(relative(repoRoot, right)),
  );
}
