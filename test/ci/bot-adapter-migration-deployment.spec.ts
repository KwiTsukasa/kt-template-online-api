import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Bot Adapter migration deployment contract', () => {
  it('ships versioned SQL and runs it in an exact-image Recreate initContainer', () => {
    const dockerfile = readFileSync(resolve('dockerfile'), 'utf8');
    const manifest = readFileSync(resolve('k8s/prod/api.yaml'), 'utf8');
    const jenkinsfile = readFileSync(resolve('Jenkinsfile'), 'utf8');

    expect(dockerfile).toContain('sql/bot-adapter-protocol-v1.sql');
    expect(dockerfile).toContain('sql/bot-adapter-menu-v1.sql');
    expect(dockerfile).toContain('sql/bot-adapter-protocol-v1-verify.sql');
    expect(dockerfile).toContain('sql/natmap-port-command-v1.sql');
    expect(dockerfile).toContain('sql/natmap-port-command-v1-verify.sql');
    expect(manifest).toContain('strategy:\n    type: Recreate');
    expect(manifest).toContain('name: bot-adapter-migration');
    expect(manifest).toContain('dist/commands/migrate-bot-adapter-protocol.js');
    expect(manifest).toContain('name: media-governance-series-work-migration');
    expect(manifest).toContain(
      'dist/commands/migrate-media-governance-series-work.js',
    );
    expect(manifest).toContain('name: kt-template-online-api-env');
    expect(jenkinsfile).toContain(
      's|k3d-kt-registry.localhost:5000/kt-template-online-api:latest|${env.DOCKER_IMAGE}|g',
    );
    expect(dockerfile).toContain('sql/media-governance-series-work-v1.sql');
    expect(dockerfile).toContain(
      'sql/media-governance-series-work-v1-verify.sql',
    );
    expect(dockerfile).toContain('sql/media-governance-rss-context-v2.sql');
    expect(dockerfile).toContain(
      'sql/media-governance-rss-context-v2-verify.sql',
    );
    expect(dockerfile).toContain('sql/media-governance-series-delete-v1.sql');
    expect(dockerfile).toContain(
      'sql/media-governance-series-delete-v1-verify.sql',
    );
    expect(dockerfile).toContain(
      'sql/media-governance-mechanical-scrape-split.sql',
    );
    expect(dockerfile).toContain(
      'sql/media-governance-mechanical-scrape-split-verify.sql',
    );
  });
});
