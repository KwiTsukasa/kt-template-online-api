import { resolve } from 'path';
import { resolveBangDreamProjectRoot } from '@/modules/plugins/bangdream/src/config/runtime-config';

describe('BangDream runtime config', () => {
  it('resolves dist plugin assets when running from compiled production output', () => {
    const compiledConfigDir = resolve(
      process.cwd(),
      'dist/modules/plugins/bangdream/src/config',
    );

    expect(resolveBangDreamProjectRoot(compiledConfigDir)).toBe(
      resolve(process.cwd(), 'dist/modules/plugins/bangdream/src'),
    );
  });
});
