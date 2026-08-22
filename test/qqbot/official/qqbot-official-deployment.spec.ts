import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('QQ official Bot deployment contract', () => {
  it('ships an idempotent additive account migration and exact read-only verification', () => {
    const migration = readSource('sql/qqbot-official-transport-v1.sql');
    const verification = readSource(
      'sql/qqbot-official-transport-v1-verify.sql',
    );
    const init = readSource('sql/qqbot-init.sql');
    const fullSchema = readSource('sql/refactor-v3/00-full-schema.sql');

    for (const source of [migration, init, fullSchema]) {
      expect(source).toContain('official_app_id');
      expect(source).toContain('official_app_secret_ciphertext');
      expect(source).toContain('uk_qqbot_account_official_app_id');
    }
    expect(migration).toContain('information_schema.columns');
    expect(migration).toContain('information_schema.statistics');
    expect(migration).not.toMatch(/\bDROP\b/iu);
    expect(migration).not.toMatch(/\bDELETE\b/iu);
    expect(verification).toContain("column_name IN (");
    expect(verification).toContain(
      "index_name = 'uk_qqbot_account_official_app_id'",
    );
    expect(verification).toContain('HAVING COUNT(*) > 1');
    expect(verification).not.toMatch(/\b(?:ALTER|DELETE|DROP|INSERT|UPDATE)\b/iu);
  });

  it('preserves raw Webhook bytes and keeps the direct NAS callback base runtime-configured', () => {
    const main = readSource('src/main.ts');
    const envExample = readSource('.env.example');
    const manifest = readSource('k8s/prod/api.yaml');

    expect(main).toContain('rawBody: true');
    expect(main).toContain("app.useBodyParser('json', { limit: '50mb' })");
    expect(envExample).toContain(
      'QQBOT_OFFICIAL_WEBHOOK_PUBLIC_BASE_URL=',
    );
    expect(envExample).toContain('不经中转的 NAS 公网 HTTPS API 基址');
    expect(envExample).not.toContain(
      'QQBOT_OFFICIAL_WEBHOOK_PUBLIC_BASE_URL=https://admin.kwitsukasa.top',
    );
    expect(manifest).toContain('name: kt-template-online-api-env');
    expect(manifest).not.toContain('QQBOT_OFFICIAL_WEBHOOK_PUBLIC_BASE_URL');
  });

  it('pins the official Tencent SDK version used by both transports', () => {
    const packageJson = JSON.parse(readSource('package.json'));
    expect(packageJson.dependencies['@tencent-connect/qqbot-nodejs']).toBe(
      '1.0.4',
    );
  });
});
