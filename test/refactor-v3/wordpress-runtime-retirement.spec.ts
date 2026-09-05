import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');

/**
 * 读取当前仓库的源码与配置，核验已退役能力没有重新接入运行时。
 * @param path 相对仓库根目录的文件路径。
 * @returns 文件的 UTF-8 文本。
 */
function readRepoFile(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('WordPress runtime retirement contract', () => {
  it('removes the executable module root and all remaining module wiring', () => {
    expect(existsSync(join(repoRoot, 'src/modules/wordpress'))).toBe(false);

    for (const file of [
      'src/app.module.ts',
      'src/modules/admin/identity/admin-identity.module.ts',
      'src/modules/admin/platform-config/admin-platform-config.module.ts',
      'src/modules/blog/blog-content.module.ts',
    ]) {
      expect(readRepoFile(file)).not.toMatch(
        /WordpressMirrorModule|modules\/wordpress/i,
      );
    }
  });

  it('removes WordPress Swagger groups and response examples', () => {
    expect(readRepoFile('src/main.ts')).not.toMatch(
      /api\/wordpress|WordPress 博客|startsWith\(['"]\/wordpress/i,
    );
    expect(readRepoFile('src/common/swagger/swagger-response.ts')).not.toMatch(
      /wordpress/i,
    );
    expect(readRepoFile('src/modules/blog/blog-content.module.ts')).not.toMatch(
      /blog_import_job|importJob|BlogLegacyAsset|BLOG_LEGACY_ASSET/,
    );
    expect(readRepoFile('sql/refactor-v3/00-full-schema.sql')).not.toMatch(
      /\bblog_import_job\b/,
    );
  });

  it('removes WordPress runtime and deployment configuration', () => {
    for (const file of [
      '.env.example',
      'Jenkinsfile',
      'src/runtime/config/runtime-config.service.ts',
      'src/runtime/config/runtime-config.types.ts',
    ]) {
      expect(readRepoFile(file)).not.toMatch(/WORDPRESS_/);
    }
  });
});
