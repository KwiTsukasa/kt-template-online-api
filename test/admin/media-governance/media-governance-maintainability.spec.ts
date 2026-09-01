import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const PRODUCTION_ROOTS = [
  'src/modules/admin/media-governance',
  'src/modules/admin/media-scrape-validation',
];
const CHINESE_CHARACTER_PATTERN = /\p{Script=Han}/u;
const FORBIDDEN_JSDOC_ENTRY_NAMES = new Set([
  'activated',
  'beforeApplicationShutdown',
  'beforeCreate',
  'beforeDestroy',
  'beforeMount',
  'beforeModuleDestroy',
  'beforeUnmount',
  'beforeUpdate',
  'created',
  'deactivated',
  'destroyed',
  'errorCaptured',
  'mounted',
  'onApplicationBootstrap',
  'onApplicationShutdown',
  'onModuleDestroy',
  'onModuleInit',
  'renderTracked',
  'renderTriggered',
  'serverPrefetch',
  'setup',
  'unmounted',
  'updated',
]);

/** 递归收集媒体治理生产目录中的 TypeScript 源文件。 */
function collectProductionFiles(targetPath: string): string[] {
  if (statSync(targetPath).isFile()) return [targetPath];
  return readdirSync(targetPath).flatMap((entry) => {
    const childPath = path.join(targetPath, entry);
    if (statSync(childPath).isDirectory()) {
      return collectProductionFiles(childPath);
    }
    if (!childPath.endsWith('.ts') || childPath.endsWith('.d.ts')) return [];
    return [childPath];
  });
}

/** 返回允许放置中文 JSDoc 的具名函数名称。 */
function namedDocumentableFunction(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): null | string {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    if (!node.name || !node.body) return null;
    return node.name.getText(sourceFile);
  }
  if (
    !ts.isMethodDeclaration(node) &&
    !ts.isGetAccessorDeclaration(node) &&
    !ts.isSetAccessorDeclaration(node)
  ) {
    return null;
  }
  if (!node.body) return null;
  const name = node.name.getText(sourceFile).replaceAll(/["']/gu, '');
  if (FORBIDDEN_JSDOC_ENTRY_NAMES.has(name)) return null;
  return name;
}

/** 判断具名函数是否带有包含中文说明的合法 JSDoc。 */
function hasChineseJsdoc(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return ts
    .getJSDocCommentsAndTags(node)
    .some((comment) =>
      CHINESE_CHARACTER_PATTERN.test(comment.getText(sourceFile)),
    );
}

/** 统计同一个条件中的逻辑判断叶子数量。 */
function countLogicalLeaves(node: ts.Expression): number {
  if (ts.isParenthesizedExpression(node)) {
    return countLogicalLeaves(node.expression);
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return countLogicalLeaves(node.left) + countLogicalLeaves(node.right);
  }
  return 1;
}

/** 按文件和行号收集媒体治理代码的可维护性违规。 */
function collectMaintainabilityViolations() {
  const ternaries: string[] = [];
  const missingJsdocs: string[] = [];
  const longConditions: string[] = [];
  const files = PRODUCTION_ROOTS.flatMap((root) =>
    collectProductionFiles(root),
  );

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      if (ts.isConditionalExpression(node)) ternaries.push(`${file}:${line}`);
      if (ts.isIfStatement(node) && countLogicalLeaves(node.expression) >= 6) {
        longConditions.push(`${file}:${line}`);
      }
      const functionName = namedDocumentableFunction(node, sourceFile);
      if (functionName && !hasChineseJsdoc(node, sourceFile)) {
        missingJsdocs.push(`${file}:${line} ${functionName}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { longConditions, missingJsdocs, ternaries };
}

/** 用有界定位信息报告完整违规计数，避免测试输出淹没有效上下文。 */
function expectNoViolations(label: string, violations: string[]): void {
  if (violations.length === 0) return;
  const visibleViolations = violations.slice(0, 20).join('\n');
  throw new Error(`${label}：${violations.length} 项\n${visibleViolations}`);
}

const MAINTAINABILITY_VIOLATIONS = collectMaintainabilityViolations();

describe('media governance production maintainability contract', () => {
  it('uses explicit branches instead of conditional expressions', () => {
    expectNoViolations('条件三元表达式', MAINTAINABILITY_VIOLATIONS.ternaries);
  });

  it('documents every legal named function with meaningful Chinese JSDoc', () => {
    expectNoViolations(
      '缺失中文 JSDoc',
      MAINTAINABILITY_VIOLATIONS.missingJsdocs,
    );
  });

  it('splits heterogeneous long condition chains into named checks', () => {
    expectNoViolations('超长条件链', MAINTAINABILITY_VIOLATIONS.longConditions);
  });
});
