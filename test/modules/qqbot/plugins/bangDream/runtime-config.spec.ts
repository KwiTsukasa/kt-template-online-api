import { resolve } from 'path';
import { resolveBangDreamProjectRoot } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';

describe('BangDream runtime config', () => {
  it('resolves source plugin assets when running from compiled dist output', () => {
    const compiledConfigDir = resolve(
      process.cwd(),
      'dist/src/modules/qqbot/plugins/bangDream/config',
    );

    expect(resolveBangDreamProjectRoot(compiledConfigDir)).toBe(
      resolve(process.cwd(), 'src/modules/qqbot/plugins/bangDream'),
    );
  });
});
