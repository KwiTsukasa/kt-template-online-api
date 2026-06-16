import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(fullPath);
      if (!entry.isFile() || !entry.name.endsWith('.ts')) return [];
      const fileStat = await stat(fullPath);
      return fileStat.isFile() ? [fullPath] : [];
    }),
  );
  return files.flat();
}

describe('BangDream theme asset preload', () => {
  it('loads title assets after runtime IO is configured during plugin activation', async () => {
    jest.resetModules();
    const { createPlugin } = await import(
      '@/modules/qqbot/plugins/bangdream/src'
    );
    const manifest = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          'src/modules/qqbot/plugins/bangdream/plugin.json',
        ),
        'utf8',
      ),
    );
    const plugin = createPlugin({
      io: {
        readAssetFile: async (filePath) => readFile(filePath),
        readExcelRows: async (filePath) => {
          const workbook = XLSX.readFile(filePath);
          return XLSX.utils.sheet_to_json(
            workbook.Sheets[workbook.SheetNames[0]],
          );
        },
      },
      operations: manifest.operations.map((operation) => ({
        handlerName: operation.handlerName as any,
        key: operation.key as any,
      })),
    });

    await plugin.activate();
    const { drawTitle } = await import(
      '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer'
    );
    const title = drawTitle('查询', '歌曲列表');

    expect(title.width).toBe(587);
    expect(title.height).toBe(110);
  });

  it('does not load local render assets at module import time', async () => {
    const srcRoot = join(
      process.cwd(),
      'src/modules/qqbot/plugins/bangdream/src',
    );
    const files = await collectTypeScriptFiles(srcRoot);
    const eagerLoaders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (source.includes('loadImageOnce();')) {
        eagerLoaders.push(file.replace(process.cwd(), '').replace(/^[\\/]/, ''));
      }
    }

    expect(eagerLoaders).toEqual([]);
  });
});
