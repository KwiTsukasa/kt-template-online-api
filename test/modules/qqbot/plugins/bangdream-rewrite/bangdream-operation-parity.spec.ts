import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../../..');
const newBangDreamRoot = join(
  repoRoot,
  'src/modules/qqbot/plugins/bangdream',
);
const baselineTest = join(
  repoRoot,
  'test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts',
);

const expectedOperationKeys = [
  'bangdream.song.search',
  'bangdream.song.chart',
  'bangdream.song.random',
  'bangdream.song.meta',
  'bangdream.card.search',
  'bangdream.card.illustration',
  'bangdream.character.search',
  'bangdream.event.search',
  'bangdream.event.stage',
  'bangdream.player.search',
  'bangdream.gacha.search',
  'bangdream.gacha.simulate',
  'bangdream.cutoff.detail',
  'bangdream.cutoff.all',
  'bangdream.cutoff.recent',
];

describe('BangDream rewritten plugin parity', () => {
  it('uses the new platform package structure', () => {
    const requiredPaths = [
      'plugin.json',
      'src/index.ts',
      'src/application/bangdream-command-context.ts',
      'src/application/catalog/bangdream-catalog-cache.ts',
      'src/application/catalog/bangdream-catalog-repository.ts',
      'src/application/execution/operation-lifecycle.ts',
      'src/operations/song-search',
      'src/operations/song-chart',
      'src/operations/song-random',
      'src/operations/song-meta',
      'src/operations/card-search',
      'src/operations/card-illustration',
      'src/operations/character-search',
      'src/operations/event-search',
      'src/operations/event-stage',
      'src/operations/player-search',
      'src/operations/gacha-search',
      'src/operations/gacha-simulate',
      'src/operations/cutoff-detail',
      'src/operations/cutoff-all',
      'src/operations/cutoff-recent',
      'src/domain/song',
      'src/domain/card',
      'src/domain/character',
      'src/domain/event',
      'src/domain/gacha',
      'src/domain/player',
      'src/domain/cutoff',
      'src/domain/catalog',
      'src/domain/common/bangdream.types.ts',
      'src/infrastructure/integration',
      'src/infrastructure/storage',
      'src/infrastructure/storage/remote-resource.client.ts',
      'src/config',
      'src/config/dictionary',
      'src/assets',
    ];

    const missing = requiredPaths.filter(
      (relativePath) => !existsSync(join(newBangDreamRoot, relativePath)),
    );

    expect(missing).toEqual([]);
  });

  it('preserves the 15 approved operation keys in the new manifest', () => {
    const manifestPath = join(newBangDreamRoot, 'plugin.json');
    expect(existsSync(manifestPath)).toBe(true);
    if (!existsSync(manifestPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      operations?: Array<{ key?: string }>;
      pluginKey?: string;
    };

    expect(manifest.pluginKey).toBe('bangdream');
    expect(manifest.operations?.map((operation) => operation.key)).toEqual(
      expectedOperationKeys,
    );
  });

  it('keeps event stage split output as a hard parity gate', () => {
    const baseline = readFileSync(baselineTest, 'utf8');
    const operationSourcePath = join(
      newBangDreamRoot,
      'src/operations/event-stage',
    );

    expect(baseline).toContain('bangdream.event.stage');
    expect(existsSync(operationSourcePath)).toBe(true);
    if (!existsSync(operationSourcePath)) return;

    const eventStageSource = readFileSync(
      join(operationSourcePath, 'index.ts'),
      'utf8',
    );
    expect(eventStageSource).toContain('expectedImageCount');
    expect(eventStageSource).toContain('5');
  });

  it('makes operation modules executable instead of handler-name placeholders', () => {
    const operationRoot = join(newBangDreamRoot, 'src/operations');
    const operationDirs = expectedOperationKeys.map((operationKey) =>
      operationKey.replace('bangdream.', '').replace(/\./g, '-'),
    );

    for (const operationDir of operationDirs) {
      const source = readFileSync(
        join(operationRoot, operationDir, 'index.ts'),
        'utf8',
      );
      expect(source).toContain('execute: async');
      expect(source).toContain('context.');
      expect(source).not.toMatch(/key: 'bangdream\./);
    }
  });

  it('uses real business directories and removes old wrapper layers', () => {
    const domainDirs = [
      'song',
      'card',
      'character',
      'event',
      'gacha',
      'player',
      'cutoff',
      'catalog',
    ];

    for (const domainDir of domainDirs) {
      expect(existsSync(join(newBangDreamRoot, 'src/domain', domainDir))).toBe(
        true,
      );
      expect(
        existsSync(join(newBangDreamRoot, 'src/domain', domainDir, 'index.ts')),
      ).toBe(false);
    }

    const removedPaths = [
      'src/application/hook/hook-registry.ts',
      'src/application/main-data-store.ts',
      'src/application/main-data.repository.ts',
      'src/application/bangdream-renderer.facade.ts',
      'src/application/bangdream-application.service.ts',
      'src/application/bangdream-context.ts',
      'src/application/bangdream-operation-runtime.ts',
      'src/application/operation-pipeline.ts',
      'src/infrastructure/storage/file-cache.client.ts',
      'src/operations/operation-executor.ts',
      'src/domain/common/bangdream-constants.ts',
      `src/qqbot-${'bangdream'}.types.ts`,
    ];
    const existingRemovedPaths = removedPaths.filter((removedPath) =>
      existsSync(join(newBangDreamRoot, removedPath)),
    );

    expect(existingRemovedPaths).toEqual([]);
  });

  it('does not reference forbidden old BangDream bucket names from runtime source', () => {
    const forbiddenFragments = [
      'application/hook/hook-registry',
      'application/main-data-store',
      'application/main-data.repository',
      'infrastructure/storage/file-cache.client',
    ];
    const runtimeFiles = [
      'src/index.ts',
      'src/application/bangdream-command-context.ts',
      'src/infrastructure/storage/asset-cache.client.ts',
      'src/infrastructure/integration/api-cache.client.ts',
    ];

    const violations = runtimeFiles.flatMap((runtimeFile) => {
      const source = readFileSync(join(newBangDreamRoot, runtimeFile), 'utf8');
      return forbiddenFragments
        .filter((fragment) => source.includes(fragment))
        .map((fragment) => `${runtimeFile} -> ${fragment}`);
    });

    expect(violations).toEqual([]);
  });
});
