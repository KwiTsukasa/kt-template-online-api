import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Bot Adapter migration deployment contract', () => {
  it('ships versioned SQL and runs it in an exact-image Recreate initContainer', () => {
    const dockerfile = readFileSync(resolve('dockerfile'), 'utf8');
    const manifest = readFileSync(resolve('k8s/prod/api.yaml'), 'utf8');
    const jenkinsfile = readFileSync(resolve('Jenkinsfile'), 'utf8');

    expect(dockerfile).toContain(
      'COPY sql/bot-adapter-protocol-v1.sql sql/bot-adapter-menu-v1.sql sql/bot-adapter-protocol-v1-verify.sql ./sql/',
    );
    expect(manifest).toContain('strategy:\n    type: Recreate');
    expect(manifest).toContain('name: bot-adapter-migration');
    expect(manifest).toContain('dist/commands/migrate-bot-adapter-protocol.js');
    expect(manifest).toContain('name: kt-template-online-api-env');
    expect(jenkinsfile).toContain('bot-adapter-migration=${env.DOCKER_IMAGE}');
  });
});
