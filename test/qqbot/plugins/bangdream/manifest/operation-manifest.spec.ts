import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

const pluginRoot = join(
  process.cwd(),
  'src/modules/qqbot/plugins/bangdream',
);

const readManifest = () =>
  parseQqbotPluginManifest(
    JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8')) as Record<
      string,
      unknown
    >,
    { pluginRoot },
  );

describe('BangDream operation manifest', () => {
  it('keeps operation keys unique and complete in plugin.json', () => {
    const manifest = readManifest();
    const operationKeys = manifest.operations.map((operation) => operation.key);

    expect(new Set(operationKeys).size).toBe(operationKeys.length);
    expect(operationKeys).toHaveLength(15);
  });

  it('keeps every operation bound to handler metadata', () => {
    const manifest = readManifest();

    for (const operation of manifest.operations) {
      expect(operation.handlerName).toEqual(expect.any(String));
      expect(operation.name).not.toHaveLength(0);
      expect(operation.description).not.toHaveLength(0);
      expect(operation.aliases.length).toBeGreaterThan(0);
      expect(operation.permissions.length).toBeGreaterThan(0);
      expect(operation.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('finds operations by key', () => {
    const manifest = readManifest();
    const byKey = new Map(
      manifest.operations.map((operation) => [operation.key, operation]),
    );

    expect(
      byKey.get('bangdream.song.search'),
    ).toMatchObject({
      handlerName: 'searchSong',
      name: '查曲',
    });
    expect(byKey.get('bangdream.unknown')).toBeUndefined();
  });
});
