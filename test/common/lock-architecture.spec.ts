import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

describe('全局锁实现边界', () => {
  it('业务模块和迁移命令不得重新定义会话锁SQL', () => {
    const root = resolve(__dirname, '../../src');
    const violations: string[] = [];
    const inspect = (directory: string) => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        const file = join(directory, item.name);
        if (item.isDirectory()) {
          inspect(file);
          continue;
        }
        if (
          !file.endsWith('.ts') ||
          relative(root, file).replaceAll('\\', '/').startsWith('common/locks/')
        )
          continue;
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        const visit = (node: ts.Node) => {
          if (
            (ts.isStringLiteral(node) ||
              ts.isNoSubstitutionTemplateLiteral(node)) &&
            /\b(GET_LOCK|RELEASE_LOCK|IS_USED_LOCK)\s*\(/i.test(node.text)
          )
            violations.push(relative(root, file));
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    inspect(root);
    expect(violations).toEqual([]);
  });
});
