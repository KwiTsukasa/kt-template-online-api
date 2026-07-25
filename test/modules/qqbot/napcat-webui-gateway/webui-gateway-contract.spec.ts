import { readFileSync } from 'fs';
import { resolve } from 'path';

const repoRoot = resolve(__dirname, '../../../..');

const readSource = (path: string) => {
  return readFileSync(resolve(repoRoot, path), 'utf8');
};

describe('NapCat WebUI Gateway contract seeds', () => {
  it('registers a dedicated Admin permission for full NapCat WebUI access', () => {
    const coreSeed = readSource('sql/refactor-v3/01-seed-core.sql');
    const qqbotSeed = readSource('sql/qqbot-init.sql');

    expect(coreSeed).toContain('QqBot:Account:WebUI');
    expect(coreSeed).toContain('QqBotAccountNapcatWebui');
    expect(qqbotSeed).toContain('QqBot:Account:WebUI');
    expect(qqbotSeed).toContain('QqBotAccountNapcatWebui');
  });

  it('verifies the gateway audit table during full schema checks', () => {
    const verifySql = readSource('sql/refactor-v3/99-verify.sql');

    expect(verifySql).toContain('qqbot_napcat_webui_gateway_audit');
    expect(verifySql).toContain('QqBot:Account:WebUI');
  });
});
