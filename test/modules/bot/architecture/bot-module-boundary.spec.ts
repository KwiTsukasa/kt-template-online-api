import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = join(__dirname, '../../../..');

const collectTypeScriptFiles = (relativeRoot: string): string[] => {
  const root = join(repoRoot, relativeRoot);
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    const filePath = join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return collectTypeScriptFiles(relative(repoRoot, filePath));
    }
    if (filePath.endsWith('.ts')) return [filePath];
    return [];
  });
};

const readSource = (filePath: string) => readFileSync(filePath, 'utf8');

const toRepoPath = (filePath: string) =>
  relative(repoRoot, filePath).replace(/\\/g, '/');

describe('Bot module boundaries', () => {
  it('keeps the protocol module limited to contracts, registry, module, and exports', () => {
    const files = collectTypeScriptFiles('src/modules/bot')
      .map(toRepoPath)
      .sort();

    expect(files).toEqual([
      'src/modules/bot/bot-protocol.module.ts',
      'src/modules/bot/contract/bot-protocol.ts',
      'src/modules/bot/index.ts',
      'src/modules/bot/registry/bot-adapter.registry.ts',
    ]);
  });

  it('prevents the protocol module from depending on stateful Bot domains or concrete platforms', () => {
    const violations = collectTypeScriptFiles('src/modules/bot')
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .flatMap(({ file, source }) => {
        const bannedPatterns = [
          /@nestjs\/typeorm|from ['"]typeorm['"]/,
          /@Entity|@InjectRepository|\bRepository\s*</,
          /modules\/bot-adapter|modules\/plugin-platform|modules\/plugins/,
          /(?:Account|Session|Conversation|Command|Rule|SendLog)(?:Entity|Repository|Service)/,
          /\b(?:Napcat|NapCat|OneBot|Tencent|Qqbot|QQBot)\b/,
          /\b(?:selfId|appId|openId|openid)\b/,
        ];
        return bannedPatterns
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${file}: ${pattern}`);
      });

    expect(violations).toEqual([]);
  });

  it('keeps Bot Adapter state under its adapter-owned directories', () => {
    const topLevelEntries = readdirSync(
      join(repoRoot, 'src/modules/bot-adapter'),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(topLevelEntries).toEqual([
      'core',
      'message-management',
      'napcat',
      'tencent',
    ]);
    expect(
      existsSync(
        join(
          repoRoot,
          'src/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity.ts',
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          repoRoot,
          'src/modules/bot-adapter/core/infrastructure/persistence/message/bot-conversation.entity.ts',
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          repoRoot,
          'src/modules/bot-adapter/core/infrastructure/persistence/send/bot-send-log.entity.ts',
        ),
      ),
    ).toBe(true);
  });

  it('keeps plugin-platform independent from Bot Adapter and concrete plugins', () => {
    const violations = collectTypeScriptFiles('src/modules/plugin-platform')
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .filter(({ source }) =>
        /modules\/bot-adapter|modules\/plugins\//.test(source),
      )
      .map(({ file }) => file);

    expect(violations).toEqual([]);
    expect(existsSync(join(repoRoot, 'src/modules/plugins'))).toBe(true);
  });

  it('removes the old QQBot runtime tree and imports from owned source', () => {
    expect(existsSync(join(repoRoot, 'src/modules/qqbot'))).toBe(false);

    const violations = [
      ...collectTypeScriptFiles('src/modules/bot'),
      ...collectTypeScriptFiles('src/modules/bot-adapter'),
      ...collectTypeScriptFiles('src/modules/plugin-platform'),
      ...collectTypeScriptFiles('src/modules/plugins'),
    ]
      .map((filePath) => ({
        file: toRepoPath(filePath),
        source: readSource(filePath),
      }))
      .filter(({ source }) =>
        /@\/modules\/qqbot|src\/modules\/qqbot|@Controller\(['"]\/?qqbot(?:\/|['"])/.test(
          source,
        ),
      )
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });
});
