import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Tencent Bot deployment contract', () => {
  it('ships an idempotent additive account migration and exact read-only verification', () => {
    const migration = readSource('sql/tencent-bot-transport-v1.sql');
    const verification = readSource('sql/tencent-bot-transport-v1-verify.sql');
    const init = readSource('sql/bot-init.sql');
    const fullSchema = readSource('sql/refactor-v3/00-full-schema.sql');

    for (const source of [migration, init, fullSchema]) {
      expect(source).toContain('official_app_id');
      expect(source).toContain('official_app_secret_ciphertext');
    }
    expect(migration).toContain('uk_qqbot_account_official_app_id');
    expect(init).toContain('uk_bot_account_official_app_id');
    expect(fullSchema).toContain('uk_bot_account_official_app_id');
    expect(migration).toContain('information_schema.columns');
    expect(migration).toContain('information_schema.statistics');
    expect(migration).not.toMatch(/\bDROP\b/iu);
    expect(migration).not.toMatch(/\bDELETE\b/iu);
    expect(verification).toContain('column_name IN (');
    expect(verification).toContain(
      "index_name = 'uk_qqbot_account_official_app_id'",
    );
    expect(verification).toContain('HAVING COUNT(*) > 1');
    expect(verification).not.toMatch(
      /\b(?:ALTER|DELETE|DROP|INSERT|UPDATE)\b/iu,
    );
  });

  it('preserves raw Webhook bytes and keeps the direct NAS callback base runtime-configured', () => {
    const main = readSource('src/main.ts');
    const envExample = readSource('.env.example');
    const manifest = readSource('k8s/prod/api.yaml');

    expect(main).toContain('rawBody: true');
    expect(main).toContain("app.useBodyParser('json', { limit: '50mb' })");
    expect(envExample).toContain('TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL=');
    expect(envExample).toContain('不经中转的 NAS 公网 HTTPS API 基址');
    expect(envExample).not.toContain(
      'TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL=https://admin.kwitsukasa.top',
    );
    expect(manifest).toContain('name: kt-template-online-api-env');
    expect(manifest).not.toContain('TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL');
  });

  it('pins the official Tencent SDK version used by both transports', () => {
    const packageJson = JSON.parse(readSource('package.json'));
    expect(packageJson.dependencies['@tencent-connect/qqbot-nodejs']).toBe(
      '1.0.4',
    );
  });

  it('uses the official high-level WebSocket lifecycle and preserves SDK reply targets', () => {
    const source = readSource(
      'src/modules/bot-adapter/tencent/infrastructure/tencent-bot.service.ts',
    );
    const commandSource = readSource(
      'src/modules/bot-adapter/core/application/command/bot-command-engine.service.ts',
    );

    expect(source).toContain(".on('message'");
    expect(source).toContain('account.bot.start(abortController.signal)');
    expect(source).toContain(
      'adapterReplyContext: this.resolveInboundReplyTarget(message)',
    );
    expect(commandSource).toContain(
      'adapterReplyContext: message.adapterReplyContext',
    );
    expect(source).toContain('resolveInboundReplyTarget');
    expect(source).toContain('resolveOutboundReplyTarget');
    expect(source).not.toContain('new sdk.protocol.GatewayConnection');
  });

  it('moves adapter bindings and plugin tables to their new owners and removes legacy tables', () => {
    const migration = readSource('sql/bot-adapter-protocol-v1.sql');
    const verification = readSource('sql/bot-adapter-protocol-v1-verify.sql');

    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS `tencent_bot_plugin_binding`',
    );
    expect(migration).toContain('`plugin`.`plugin_key`');
    expect(migration).toContain('DROP TABLE `qqbot_plugin_account_binding`');
    expect(migration).toContain(
      "CALL `kt_migrate_bot_table`('qqbot_plugin', 'plugin')",
    );
    expect(verification).toContain('legacy_table_count');
    expect(verification).toContain("'qqbot_plugin_account_binding'");
    expect(verification).toContain('canonical_table_count');
    expect(verification).not.toMatch(
      /^\s*(?:ALTER|DELETE|DROP|INSERT|TRUNCATE|UPDATE)\b/imu,
    );
  });
});
