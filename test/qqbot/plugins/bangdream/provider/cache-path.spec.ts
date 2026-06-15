import * as path from 'path';
import {
  getCacheDirectory,
  getFileNameFromUrl,
} from '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/cache-path';

describe('BangDream cache path', () => {
  it('resolves relative asset paths before creating cache directories', () => {
    const directory = getCacheDirectory(
      '/assets/cn/event/foo/topscreen_rip/bg_eventtop.png',
    );

    const normalizedDirectory = directory.replace(/[\\/]/g, '_');
    expect(directory).toContain(
      path.join('.kt-workspace', 'cache', 'bangdream'),
    );
    expect(directory).toContain('bestdori.com');
    expect(normalizedDirectory).toContain('assets_cn_event_foo_topscreen_rip');
  });

  it('resolves relative api paths before creating cache file names', () => {
    expect(getFileNameFromUrl('/api/events/50.json')).toBe('50.json');
  });

  it('keeps absolute urls unchanged for cache file names', () => {
    expect(getFileNameFromUrl('https://example.com/api/events/50')).toBe(
      '50.json',
    );
  });
});
