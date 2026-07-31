import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');

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
    const contractMatrix = readRepoFile(
      'docs/refactor-v3/api-admin-contract-matrix.md',
    );

    expect(contractMatrix).not.toMatch(/\/wordpress\/\*|WordPress pages/i);
    expect(contractMatrix).toContain(
      'WordPress 运行路由与 Blog 导入端点已在 Phase 1 退役',
    );
    expect(contractMatrix).toContain(
      'Phase 2 发布候选已移除\n`blog_import_job` 的运行时与新建库契约',
    );
    expect(contractMatrix).toMatch(
      /既有生产物理表仍保留到观察期结束并取得\s+新的破坏性授权/,
    );
    expect(readRepoFile('src/modules/blog/blog-content.module.ts')).not.toMatch(
      /blog_import_job|importJob/,
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
