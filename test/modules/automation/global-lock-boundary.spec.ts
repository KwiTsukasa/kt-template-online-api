import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as ts from 'typescript';

it('模块只能调用公共锁端口，原生会话锁 SQL 归全局锁实现所有', () => {
  const sourceRoot = resolve(__dirname, '../../../src');
  const violations: string[] = [];
  const files = readdirSync(sourceRoot, { recursive: true }) as string[];
  for (const file of files) {
    if (
      !file.endsWith('.ts') ||
      file.replaceAll('\\', '/').startsWith('common/locks/')
    )
      continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(join(sourceRoot, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isStringLiteralLike(node) &&
        /\b(?:GET_LOCK|RELEASE_LOCK|IS_USED_LOCK)\s*\(/i.test(node.text)
      )
        violations.push(
          `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        );
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});
