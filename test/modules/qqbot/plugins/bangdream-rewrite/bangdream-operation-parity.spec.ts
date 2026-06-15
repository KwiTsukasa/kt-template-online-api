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
      'src/application',
      'src/infrastructure/integration',
      'src/infrastructure/storage',
      'src/config',
      'src/assets',
      'src/migrations',
      'src/tests',
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
    expect(eventStageSource).toContain('imageCount');
    expect(eventStageSource).toContain('5');
  });
});
