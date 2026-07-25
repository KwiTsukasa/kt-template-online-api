#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.mjs',
  '.ts',
  '.tsx',
  '.vue',
]);
const SOURCE_PATHSPECS = ['*.cjs', '*.js', '*.mjs', '*.ts', '*.tsx', '*.vue'];
const CHINESE_CHARACTER_PATTERN = /\p{Script=Han}/u;
const VUE_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
const LIFECYCLE_ENTRY_NAMES = new Set([
  'activated',
  'afterInit',
  'afterInsert',
  'afterLoad',
  'afterQuery',
  'afterRecover',
  'afterRemove',
  'afterSoftRemove',
  'afterTransactionCommit',
  'afterTransactionRollback',
  'afterTransactionStart',
  'afterUpdate',
  'beforeApplicationShutdown',
  'beforeCreate',
  'beforeDestroy',
  'beforeInsert',
  'beforeMount',
  'beforeModuleDestroy',
  'beforeQuery',
  'beforeRecover',
  'beforeRemove',
  'beforeSoftRemove',
  'beforeTransactionCommit',
  'beforeTransactionRollback',
  'beforeTransactionStart',
  'beforeUnmount',
  'beforeUpdate',
  'componentDidCatch',
  'componentDidMount',
  'componentDidUpdate',
  'componentWillMount',
  'componentWillReceiveProps',
  'componentWillUnmount',
  'componentWillUpdate',
  'created',
  'deactivated',
  'destroyed',
  'errorCaptured',
  'getDerivedStateFromError',
  'getSnapshotBeforeUpdate',
  'handleConnection',
  'handleDisconnect',
  'mounted',
  'onApplicationBootstrap',
  'onApplicationShutdown',
  'onModuleDestroy',
  'onModuleInit',
  'renderTracked',
  'renderTriggered',
  'serverPrefetch',
  'shouldComponentUpdate',
  'unmounted',
  'updated',
]);

function getScriptKind(filePath, attributes = '') {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  if (extension === '.vue') {
    if (/\blang\s*=\s*["']tsx["']/iu.test(attributes)) {
      return ts.ScriptKind.TSX;
    }
    if (/\blang\s*=\s*["'](?:js|jsx)["']/iu.test(attributes)) {
      return ts.ScriptKind.JS;
    }
  }

  return ts.ScriptKind.TS;
}

function getScriptBlocks(filePath, sourceText) {
  if (path.extname(filePath).toLowerCase() !== '.vue') {
    return [
      {
        contentOffset: 0,
        filePath,
        lineOffset: 0,
        scriptKind: getScriptKind(filePath),
        sourceText,
      },
    ];
  }

  const blocks = [];
  let match;

  VUE_SCRIPT_PATTERN.lastIndex = 0;
  while ((match = VUE_SCRIPT_PATTERN.exec(sourceText)) !== null) {
    const openingTagEnd = match[0].indexOf('>') + 1;
    const contentOffset = match.index + openingTagEnd;
    const lineOffset = (
      sourceText.slice(0, contentOffset).match(/\r\n|\r|\n/gu) || []
    ).length;
    const scriptKind = getScriptKind(filePath, match[1]);
    const extension =
      scriptKind === ts.ScriptKind.TSX
        ? 'tsx'
        : scriptKind === ts.ScriptKind.JS
          ? 'js'
          : 'ts';

    blocks.push({
      contentOffset,
      filePath: `${filePath}#script-${blocks.length + 1}.${extension}`,
      lineOffset,
      scriptKind,
      sourceText: match[2],
    });
  }

  return blocks;
}

function getNodeName(node, sourceFile) {
  if (!node.name) return undefined;

  if (
    ts.isIdentifier(node.name) ||
    ts.isPrivateIdentifier(node.name) ||
    ts.isStringLiteral(node.name) ||
    ts.isNumericLiteral(node.name)
  ) {
    return node.name.text;
  }

  return node.name.getText(sourceFile);
}

function classifyOwner(node, sourceFile) {
  if (!node) {
    return {
      code: 'invalid-target',
      ownerKind: 'UnattachedJSDoc',
      reason: 'JSDoc 未归属于允许的具名函数或方法',
    };
  }

  const isNamedFunction =
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    Boolean(node.name);
  const isNamedMethod =
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);

  if (!isNamedFunction && !isNamedMethod) {
    return {
      code: 'invalid-target',
      ownerKind: ts.SyntaxKind[node.kind],
      reason: 'JSDoc 只能用于具名函数声明、显式具名函数表达式或具名方法',
    };
  }

  const ownerName = getNodeName(node, sourceFile);
  if (ownerName === 'setup' || LIFECYCLE_ENTRY_NAMES.has(ownerName)) {
    return {
      code: 'forbidden-entry',
      ownerKind: ts.SyntaxKind[node.kind],
      ownerName,
      reason: `${ownerName} 是禁止使用 JSDoc 的 setup 或生命周期入口`,
    };
  }

  return {
    ownerKind: ts.SyntaxKind[node.kind],
    ownerName,
  };
}

function collectOwnedJsDocs(sourceFile) {
  const ownedDocs = new Map();

  function visit(node) {
    for (const jsDoc of node.jsDoc || []) {
      ownedDocs.set(`${jsDoc.getStart(sourceFile)}:${jsDoc.end}`, {
        jsDoc,
        owner: node,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return ownedDocs;
}

function getLeafTokens(sourceFile) {
  const tokens = [];

  function visit(node) {
    if (
      node.kind >= ts.SyntaxKind.FirstJSDocNode &&
      node.kind <= ts.SyntaxKind.LastJSDocNode
    ) {
      return;
    }

    if (
      node.kind >= ts.SyntaxKind.FirstToken &&
      node.kind <= ts.SyntaxKind.LastToken
    ) {
      tokens.push(node);
      return;
    }

    for (const child of node.getChildren(sourceFile)) {
      visit(child);
    }
  }

  visit(sourceFile);
  return tokens.sort(
    (left, right) => left.getStart(sourceFile) - right.getStart(sourceFile),
  );
}

function scanTriviaGap(sourceText, start, end) {
  if (start >= end) return [];

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    sourceText.slice(start, end),
  );
  const comments = [];
  let token;

  do {
    token = scanner.scan();
    if (
      token === ts.SyntaxKind.MultiLineCommentTrivia &&
      scanner.getTokenText().startsWith('/**')
    ) {
      comments.push({
        end: start + scanner.getTextPos(),
        start: start + scanner.getTokenPos(),
      });
    }
  } while (token !== ts.SyntaxKind.EndOfFileToken);

  return comments;
}

function collectRawJsDocs(sourceFile) {
  const sourceText = sourceFile.text;
  const comments = [];
  let cursor = 0;

  for (const token of getLeafTokens(sourceFile)) {
    const tokenStart = token.getStart(sourceFile);
    comments.push(...scanTriviaGap(sourceText, cursor, tokenStart));
    cursor = Math.max(cursor, token.end);
  }
  comments.push(...scanTriviaGap(sourceText, cursor, sourceText.length));

  return comments;
}

function analyzeScriptBlock(block) {
  const sourceFile = ts.createSourceFile(
    block.filePath,
    block.sourceText,
    ts.ScriptTarget.Latest,
    true,
    block.scriptKind,
  );
  const ownedDocs = collectOwnedJsDocs(sourceFile);
  const rawDocs = collectRawJsDocs(sourceFile);
  const issues = [];
  const removals = [];
  let retainedCount = 0;

  for (const rawDoc of rawDocs) {
    const start = rawDoc.start;
    const end = rawDoc.end;
    const text = block.sourceText.slice(start, end);
    const owner = ownedDocs.get(`${start}:${end}`)?.owner;
    const classification = classifyOwner(owner, sourceFile);
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    const common = {
      column: position.character + 1,
      end: block.contentOffset + end,
      filePath: block.filePath.replace(/#script-\d+\.(?:js|ts|tsx)$/u, ''),
      line: block.lineOffset + position.line + 1,
      ownerKind: classification.ownerKind,
      ownerName: classification.ownerName,
      start: block.contentOffset + start,
    };

    if (classification.code) {
      issues.push({
        ...common,
        code: classification.code,
        reason: classification.reason,
      });
      removals.push({
        end: common.end,
        start: common.start,
      });
      continue;
    }

    if (!CHINESE_CHARACTER_PATTERN.test(text)) {
      issues.push({
        ...common,
        code: 'missing-chinese-description',
        reason: 'JSDoc 描述必须整体以中文为主，不能是纯英文或仅标签',
      });
      removals.push({
        end: common.end,
        start: common.start,
      });
      continue;
    }

    retainedCount += 1;
  }

  return {
    issues,
    removals,
    retainedCount,
    totalCount: rawDocs.length,
  };
}

function analyzeSourceText(filePath, sourceText) {
  const results = getScriptBlocks(filePath, sourceText).map(analyzeScriptBlock);
  const issues = results.flatMap((result) => result.issues);

  return {
    issues,
    removals: results.flatMap((result) => result.removals),
    stats: {
      forbiddenEntryCount: issues.filter(
        (issue) => issue.code === 'forbidden-entry',
      ).length,
      invalidTargetCount: issues.filter(
        (issue) => issue.code === 'invalid-target',
      ).length,
      missingChineseCount: issues.filter(
        (issue) => issue.code === 'missing-chinese-description',
      ).length,
      retainedCount: results.reduce(
        (sum, result) => sum + result.retainedCount,
        0,
      ),
      totalCount: results.reduce((sum, result) => sum + result.totalCount, 0),
    },
  };
}

export function validateSourceText(filePath, sourceText) {
  const analysis = analyzeSourceText(filePath, sourceText);
  return {
    issues: analysis.issues,
    stats: analysis.stats,
  };
}

function expandStandaloneRemoval(sourceText, removal) {
  const lineStart = sourceText.lastIndexOf('\n', removal.start - 1) + 1;
  const nextLineBreak = sourceText.indexOf('\n', removal.end);
  const lineEnd = nextLineBreak === -1 ? sourceText.length : nextLineBreak + 1;
  const before = sourceText.slice(lineStart, removal.start);
  const after = sourceText.slice(
    removal.end,
    nextLineBreak === -1 ? sourceText.length : nextLineBreak,
  );

  if (before.trim() === '' && after.trim() === '') {
    return {
      end: lineEnd,
      start: lineStart,
    };
  }

  const horizontalWhitespace = before.match(/[^\S\r\n]+$/u)?.[0];
  if (horizontalWhitespace) {
    return {
      end: removal.end,
      start: removal.start - horizontalWhitespace.length,
    };
  }

  return removal;
}

function mergeRemovals(removals) {
  const sorted = [...removals].sort((left, right) => left.start - right.start);
  const merged = [];

  for (const removal of sorted) {
    const previous = merged.at(-1);
    if (previous && removal.start <= previous.end) {
      previous.end = Math.max(previous.end, removal.end);
    } else {
      merged.push({ ...removal });
    }
  }

  return merged;
}

export function fixSourceText(filePath, sourceText) {
  const analysis = analyzeSourceText(filePath, sourceText);
  const removals = mergeRemovals(
    analysis.removals.map((removal) =>
      expandStandaloneRemoval(sourceText, removal),
    ),
  );
  let fixedSourceText = sourceText;

  for (const removal of removals.toReversed()) {
    fixedSourceText =
      fixedSourceText.slice(0, removal.start) +
      fixedSourceText.slice(removal.end);
  }

  return {
    removedCount: analysis.removals.length,
    sourceText: fixedSourceText,
    stats: analysis.stats,
  };
}

function tokenizeScript(filePath, sourceText, scriptKind) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  return getLeafTokens(sourceFile)
    .filter((node) => node.kind !== ts.SyntaxKind.EndOfFileToken)
    .map((node) => `${node.kind}:${node.getText(sourceFile)}`);
}

export function getTokenSignature(filePath, sourceText) {
  return getScriptBlocks(filePath, sourceText).flatMap((block, index) => [
    `script-block:${index}:${block.scriptKind}`,
    ...tokenizeScript(block.filePath, block.sourceText, block.scriptKind),
  ]);
}

function getRepositoryRoot(cwd) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function isSupportedSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function splitNullDelimited(output) {
  return output.toString('utf8').split('\0').filter(Boolean);
}

function listCurrentSourceFiles(repoRoot) {
  const output = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...SOURCE_PATHSPECS,
    ],
    {
      cwd: repoRoot,
      encoding: 'buffer',
    },
  );

  return splitNullDelimited(output).filter(isSupportedSourceFile).sort();
}

function listRefSourceFiles(repoRoot, ref) {
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', ref],
    {
      cwd: repoRoot,
      encoding: 'buffer',
    },
  );

  return splitNullDelimited(output).filter(isSupportedSourceFile).sort();
}

function findFirstTokenDifference(beforeTokens, afterTokens) {
  const length = Math.max(beforeTokens.length, afterTokens.length);

  for (let index = 0; index < length; index += 1) {
    if (beforeTokens[index] !== afterTokens[index]) {
      return {
        after: afterTokens[index],
        before: beforeTokens[index],
        index,
      };
    }
  }

  return undefined;
}

function compareRepositoryTokens(
  repoRoot,
  ref,
  currentFiles,
  allowedTokenChanges,
) {
  const currentFileSet = new Set(currentFiles);
  const refFiles = listRefSourceFiles(repoRoot, ref);
  const refFileSet = new Set(refFiles);
  const allowedMismatches = [];
  const mismatches = [];
  let comparedFiles = 0;
  let comparedTokens = 0;

  for (const filePath of refFiles) {
    const absolutePath = path.resolve(repoRoot, filePath);
    if (!currentFileSet.has(filePath) || !existsSync(absolutePath)) {
      mismatches.push({
        filePath,
        reason: '基线文件在当前工作树中缺失',
      });
      continue;
    }

    const beforeSource = execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const afterSource = readFileSync(absolutePath, 'utf8');
    const beforeTokens = getTokenSignature(filePath, beforeSource);
    const afterTokens = getTokenSignature(filePath, afterSource);
    const difference = findFirstTokenDifference(beforeTokens, afterTokens);

    if (difference) {
      const mismatch = {
        difference,
        filePath,
        reason: '非注释 token 与基线不一致',
      };
      if (allowedTokenChanges.has(filePath)) {
        allowedMismatches.push(mismatch);
      } else {
        mismatches.push(mismatch);
      }
      continue;
    }

    comparedFiles += 1;
    comparedTokens += beforeTokens.length;
  }

  return {
    allowedMismatches,
    comparedFiles,
    comparedTokens,
    mismatches,
    newFilesSkipped: currentFiles.filter(
      (filePath) => !refFileSet.has(filePath),
    ),
    ref,
  };
}

function addStats(target, stats) {
  for (const [key, value] of Object.entries(stats)) {
    target[key] += value;
  }
}

function parseOption(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptionList(args, name) {
  const values = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    } else if (arg === name && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }

  return new Set(
    values
      .flatMap((value) => value.split(','))
      .map((value) => value.trim().replaceAll('\\', '/'))
      .filter(Boolean),
  );
}

function printIssues(issues) {
  for (const issue of issues) {
    const owner = issue.ownerName
      ? `${issue.ownerKind} ${issue.ownerName}`
      : issue.ownerKind;
    console.error(
      `${issue.filePath}:${issue.line}:${issue.column} ${issue.code} ${owner}: ${issue.reason}`,
    );
  }
}

function runRepositoryCheck({
  allowedTokenChanges,
  compareRef,
  fix,
  repoRoot,
}) {
  const files = listCurrentSourceFiles(repoRoot);
  const issues = [];
  const totals = {
    forbiddenEntryCount: 0,
    invalidTargetCount: 0,
    missingChineseCount: 0,
    retainedCount: 0,
    totalCount: 0,
  };
  let changedFiles = 0;
  let removedCount = 0;

  for (const filePath of files) {
    const absolutePath = path.resolve(repoRoot, filePath);
    const sourceText = readFileSync(absolutePath, 'utf8');

    if (fix) {
      const result = fixSourceText(filePath, sourceText);
      addStats(totals, result.stats);
      removedCount += result.removedCount;
      if (result.sourceText !== sourceText) {
        writeFileSync(absolutePath, result.sourceText);
        changedFiles += 1;
      }
      continue;
    }

    const result = validateSourceText(filePath, sourceText);
    addStats(totals, result.stats);
    issues.push(...result.issues);
  }

  const comparison = compareRef
    ? compareRepositoryTokens(repoRoot, compareRef, files, allowedTokenChanges)
    : undefined;
  const summary = {
    changedFiles,
    comparison,
    filesScanned: files.length,
    issues: issues.length,
    mode: fix ? 'fix' : 'check',
    removedCount,
    ...totals,
  };

  if (issues.length > 0) {
    printIssues(issues);
  }
  if (comparison?.mismatches.length) {
    for (const mismatch of comparison.mismatches) {
      console.error(`${mismatch.filePath}: ${mismatch.reason}`);
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (issues.length > 0 || comparison?.mismatches.length) {
    process.exitCode = 1;
  }
}

function main() {
  const args = process.argv.slice(2);
  const repoRoot = getRepositoryRoot(
    path.resolve(parseOption(args, '--repo-root') || process.cwd()),
  );

  runRepositoryCheck({
    allowedTokenChanges: parseOptionList(args, '--allow-token-change'),
    compareRef: parseOption(args, '--compare-ref'),
    fix: args.includes('--fix'),
    repoRoot,
  });
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (invokedUrl === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
