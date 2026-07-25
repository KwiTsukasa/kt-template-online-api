#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
const LINE_TERMINATOR_PATTERN = /\r\n|\r|\n/u;
const VUE_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
const TYPEORM_ENTITY_LISTENER_DECORATORS = new Set([
  'AfterInsert',
  'AfterLoad',
  'AfterRecover',
  'AfterRemove',
  'AfterSoftRemove',
  'AfterUpdate',
  'BeforeInsert',
  'BeforeRecover',
  'BeforeRemove',
  'BeforeSoftRemove',
  'BeforeUpdate',
]);
const CODE_ONLY_TAGS = new Set(['example']);
const STRUCTURAL_TAGS = new Set([
  'alias',
  'author',
  'borrows',
  'callback',
  'constant',
  'constructs',
  'copyright',
  'default',
  'defaultvalue',
  'enum',
  'exports',
  'extends',
  'external',
  'fires',
  'implements',
  'kind',
  'license',
  'link',
  'listens',
  'member',
  'memberof',
  'mixes',
  'module',
  'name',
  'namespace',
  'requires',
  'satisfies',
  'since',
  'this',
  'type',
  'typedef',
  'version',
]);
const BARE_TYPE_TAGS = new Set([
  'exception',
  'return',
  'returns',
  'throws',
  'yield',
  'yields',
]);
const PARAMETER_TAGS = new Set([
  'arg',
  'argument',
  'param',
  'prop',
  'property',
  'template',
  'typeparam',
]);
const BUILTIN_TYPE_NAMES = new Set([
  'any',
  'bigint',
  'boolean',
  'never',
  'null',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
  'unknown',
  'void',
]);
const ENGLISH_FUNCTION_WORDS = new Set([
  'a',
  'after',
  'an',
  'and',
  'are',
  'as',
  'at',
  'before',
  'by',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'otherwise',
  'that',
  'the',
  'these',
  'this',
  'those',
  'to',
  'was',
  'were',
  'when',
  'whether',
  'with',
]);
const LEADING_DESCRIPTION_VERBS = new Set([
  'build',
  'check',
  'cleanup',
  'convert',
  'create',
  'delete',
  'determine',
  'ensure',
  'fetch',
  'format',
  'get',
  'handle',
  'initialize',
  'load',
  'parse',
  'read',
  'remove',
  'render',
  'resolve',
  'return',
  'save',
  'send',
  'set',
  'transform',
  'update',
  'use',
  'validate',
  'write',
]);
const LIFECYCLE_ENTRY_NAMES = new Set([
  'activated',
  'afterInit',
  'afterQuery',
  'afterTransactionCommit',
  'afterTransactionRollback',
  'afterTransactionStart',
  'beforeApplicationShutdown',
  'beforeCreate',
  'beforeDestroy',
  'beforeMount',
  'beforeModuleDestroy',
  'beforeQuery',
  'beforeTransactionCommit',
  'beforeTransactionRollback',
  'beforeTransactionStart',
  'beforeUnmount',
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

  if (ts.isComputedPropertyName(node.name)) {
    const expression = node.name.expression;
    if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
      return expression.text;
    }
  }

  return node.name.getText(sourceFile);
}

function getFunctionExpressionRole(node, sourceFile) {
  let expression = node;
  while (
    (ts.isParenthesizedExpression(expression.parent) ||
      ts.isAsExpression(expression.parent) ||
      ts.isTypeAssertionExpression(expression.parent) ||
      ts.isNonNullExpression(expression.parent) ||
      ts.isSatisfiesExpression(expression.parent)) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }

  const parent = expression.parent;
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.initializer === expression
  ) {
    return getNodeName(parent, sourceFile);
  }

  return undefined;
}

function collectTypeOrmListenerBindings(sourceFile) {
  const importedNames = new Set();
  const namespaceNames = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'typeorm' ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }

    const namedBindings = statement.importClause?.namedBindings;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaceNames.add(namedBindings.name.text);
      continue;
    }
    if (!ts.isNamedImports(namedBindings)) continue;

    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text || element.name.text;
      if (
        !element.isTypeOnly &&
        TYPEORM_ENTITY_LISTENER_DECORATORS.has(importedName)
      ) {
        importedNames.add(element.name.text);
      }
    }
  }

  return {
    importedNames,
    namespaceNames,
  };
}

function getTypeOrmListenerDecoratorName(node, bindings) {
  if (!ts.canHaveDecorators(node)) return undefined;

  for (const decorator of ts.getDecorators(node) || []) {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;

    if (
      ts.isIdentifier(expression) &&
      bindings.importedNames.has(expression.text)
    ) {
      return expression.text;
    }

    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      bindings.namespaceNames.has(expression.expression.text) &&
      TYPEORM_ENTITY_LISTENER_DECORATORS.has(expression.name.text)
    ) {
      return expression.name.text;
    }
  }

  return undefined;
}

function maskNonNaturalLanguage(text) {
  return text
    .replace(/```[\s\S]*?```/gu, (code) => code.replace(/[^\r\n]/gu, '\0'))
    .replace(/`[^`\r\n]*`/gu, '\0')
    .replace(/\{@(?:code|link|linkcode|linkplain)\s+[^}]+\}/giu, '\0')
    .replace(/\b(?:https?|ftp):\/\/[^\s<>{}|\\^`[\]]+/giu, '\0')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, '\0')
    .replace(/\bv?\d+(?:\.\d+){1,}\b/gu, '\0')
    .replace(/<[^>\r\n]+>/gu, '\0')
    .replace(/^[\s*-]+/u, '')
    .trim();
}

function splitDescriptionSentences(text) {
  return text
    .split(/(?:[。！？；]+|[.!?;]+(?=\s|$))/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.replaceAll('\0', '').trim());
}

function isStrongTechnicalWord(word) {
  if (/\d/u.test(word)) return true;
  return (
    word === word.toUpperCase() ||
    /[_$]/u.test(word) ||
    /[A-Z]/u.test(word.slice(1))
  );
}

function isTitleCaseWord(word) {
  return /^[A-Z][a-z]+(?:-[A-Z]?[a-z]+)*$/u.test(word);
}

function isLeadingDescriptionVerb(word) {
  const lower = word.toLowerCase();
  const candidates = new Set([lower]);

  if (lower.endsWith('ies')) {
    candidates.add(`${lower.slice(0, -3)}y`);
  }
  if (lower.endsWith('ing')) {
    const stem = lower.slice(0, -3);
    candidates.add(stem);
    candidates.add(`${stem}e`);
    if (stem.at(-1) === stem.at(-2)) {
      candidates.add(stem.slice(0, -1));
    }
  }
  if (lower.endsWith('ed')) {
    const stem = lower.slice(0, -2);
    candidates.add(stem);
    candidates.add(`${stem}e`);
  }
  if (lower.endsWith('es')) {
    candidates.add(lower.slice(0, -2));
    candidates.add(lower.slice(0, -1));
  } else if (lower.endsWith('s')) {
    candidates.add(lower.slice(0, -1));
  }

  return [...candidates].some((candidate) =>
    LEADING_DESCRIPTION_VERBS.has(candidate),
  );
}

function containsEnglishClause(sentence) {
  const chineseCount = [...sentence].filter((character) =>
    CHINESE_CHARACTER_PATTERN.test(character),
  ).length;

  for (const region of sentence.split(/[\p{Script=Han}\0]+/u)) {
    const words = [
      ...region.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*/gu),
    ].map((match) => match[0]);
    const ordinaryWords = words.filter((word) => !isStrongTechnicalWord(word));
    if (ordinaryWords.length === 0) continue;

    if (
      ordinaryWords.length >= 2 &&
      isLeadingDescriptionVerb(ordinaryWords[0])
    ) {
      return true;
    }

    const isTitleCaseTechnicalPhrase = words.every(
      (word) => isStrongTechnicalWord(word) || isTitleCaseWord(word),
    );
    if (isTitleCaseTechnicalPhrase) continue;

    const hasFunctionWord = ordinaryWords.some((word) =>
      ENGLISH_FUNCTION_WORDS.has(word.toLowerCase()),
    );

    if (
      (ordinaryWords.length >= 2 && hasFunctionWord) ||
      (ordinaryWords.length >= 4 && ordinaryWords.length > chineseCount)
    ) {
      return true;
    }
  }

  return false;
}

function isBareTypePayload(text) {
  const payload = text.trim();
  if (!payload || payload.startsWith('-')) return false;

  const rootName = payload.match(/^[A-Za-z_$][A-Za-z0-9_$]*/u)?.[0];
  if (
    !rootName ||
    (!BUILTIN_TYPE_NAMES.has(rootName) && !/^[A-Z]/u.test(rootName))
  ) {
    return false;
  }

  const sourceFile = ts.createSourceFile(
    'jsdoc-type.ts',
    `type JSDocPayload = ${payload};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return sourceFile.parseDiagnostics.length === 0;
}

function stripLeadingTypeExpression(text) {
  const trimmedText = text.trimStart();
  if (!trimmedText.startsWith('{')) return trimmedText;

  let depth = 0;
  for (let index = 0; index < trimmedText.length; index += 1) {
    const character = trimmedText[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return trimmedText.slice(index + 1).trimStart();
      }
    }
  }

  return trimmedText;
}

function getTagDescription(tagName, rawValue) {
  if (CODE_ONLY_TAGS.has(tagName)) return undefined;

  if (STRUCTURAL_TAGS.has(tagName) || tagName === 'see') {
    const separatorIndex = rawValue.indexOf(' - ');
    return separatorIndex === -1
      ? undefined
      : rawValue.slice(separatorIndex + 3).trim() || undefined;
  }

  let value = stripLeadingTypeExpression(rawValue);
  if (PARAMETER_TAGS.has(tagName)) {
    value = value
      .replace(/^(?:\[[^\]]+\]|[^\s-]+)\s*/u, '')
      .replace(/^-\s*/u, '');
  } else if (BARE_TYPE_TAGS.has(tagName) && isBareTypePayload(value)) {
    return undefined;
  }

  return value.trim() || undefined;
}

function collectDescriptionUnits(rawComment) {
  const units = [];
  const bodyLines = rawComment
    .replace(/^\/\*\*/u, '')
    .replace(/\*\/$/u, '')
    .split(/\r\n|\r|\n/u)
    .map((line) => line.replace(/^\s*\*\s?/u, '').trimEnd());
  let current = {
    label: '主说明',
    lines: [],
    startLineOffset: 0,
    tagName: undefined,
  };
  let insideFence = false;

  function flushCurrent() {
    const firstContentLine = current.lines.findIndex(
      (line) => line.trim() !== '',
    );
    if (firstContentLine === -1) return;

    const rawValue = current.lines.slice(firstContentLine).join('\n').trim();
    if (!rawValue) return;

    const lineOffset = current.startLineOffset + firstContentLine;
    if (!current.tagName) {
      units.push({
        label: current.label,
        lineOffset,
        text: rawValue,
      });
      return;
    }

    const description = getTagDescription(current.tagName, rawValue);
    if (description) {
      units.push({
        label: current.label,
        lineOffset,
        text: description,
      });
    }
  }

  for (let lineOffset = 0; lineOffset < bodyLines.length; lineOffset += 1) {
    const line = bodyLines[lineOffset];
    const fenceCount = line.match(/```/gu)?.length || 0;

    if (insideFence) {
      current.lines.push(line);
      if (fenceCount % 2 === 1) insideFence = false;
      continue;
    }
    if (fenceCount > 0) {
      current.lines.push(line);
      if (fenceCount % 2 === 1) insideFence = true;
      continue;
    }
    if (!current.tagName && !line.trim()) {
      flushCurrent();
      current = {
        label: '主说明',
        lines: [],
        startLineOffset: lineOffset + 1,
        tagName: undefined,
      };
      continue;
    }

    const tagMatch = line.match(/^@([A-Za-z][\w-]*)(?:\s(.*))?$/u);
    if (tagMatch) {
      if (current.tagName === 'example' && /^[A-Z]/u.test(tagMatch[1])) {
        continue;
      }

      flushCurrent();
      const tagName = tagMatch[1].toLowerCase();
      current = {
        label: `@${tagName}`,
        lines: CODE_ONLY_TAGS.has(tagName) ? [] : [tagMatch[2] || ''],
        startLineOffset: lineOffset,
        tagName,
      };
      continue;
    }

    if (!CODE_ONLY_TAGS.has(current.tagName)) {
      current.lines.push(line);
    }
  }
  flushCurrent();

  return units;
}

function findDescriptionIssue(rawComment) {
  const units = collectDescriptionUnits(rawComment);

  for (const unit of units) {
    const maskedText = maskNonNaturalLanguage(unit.text);
    const unitHasChinese = CHINESE_CHARACTER_PATTERN.test(maskedText);
    const lines = maskedText.split(/\r\n|\r|\n/u);

    for (let lineOffset = 0; lineOffset < lines.length; lineOffset += 1) {
      const sentences = splitDescriptionSentences(lines[lineOffset]);

      for (const sentence of sentences) {
        const hasChinese = CHINESE_CHARACTER_PATTERN.test(sentence);
        const hasEnglishClause = containsEnglishClause(sentence);

        if (!hasChinese) {
          if (unitHasChinese && !hasEnglishClause) continue;
          return {
            label: unit.label,
            lineOffset: unit.lineOffset + lineOffset,
            reason: `${unit.label} 描述必须使用中文`,
          };
        }

        if (hasEnglishClause) {
          return {
            label: unit.label,
            lineOffset: unit.lineOffset + lineOffset,
            reason: `${unit.label} 描述包含完整英文说明，必须改为中文`,
          };
        }
      }
    }
  }

  return undefined;
}

function classifyOwner(node, sourceFile, typeOrmBindings) {
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
  const typeOrmListenerName = getTypeOrmListenerDecoratorName(
    node,
    typeOrmBindings,
  );
  const roleName = ts.isFunctionExpression(node)
    ? getFunctionExpressionRole(node, sourceFile)
    : ts.isFunctionDeclaration(node)
      ? undefined
      : ownerName;
  const isSetupEntry = roleName === 'setup';
  const lifecycleEntryName =
    roleName && LIFECYCLE_ENTRY_NAMES.has(roleName) ? roleName : undefined;

  if (isSetupEntry || lifecycleEntryName || typeOrmListenerName) {
    const entryName = typeOrmListenerName
      ? `@${typeOrmListenerName}`
      : lifecycleEntryName || roleName;
    return {
      code: 'forbidden-entry',
      ownerKind: ts.SyntaxKind[node.kind],
      ownerName,
      reason: `${entryName} 是禁止使用 JSDoc 的 setup 或生命周期入口`,
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
  const typeOrmBindings = collectTypeOrmListenerBindings(sourceFile);
  const issues = [];
  const removals = [];
  let retainedCount = 0;

  for (const rawDoc of rawDocs) {
    const start = rawDoc.start;
    const end = rawDoc.end;
    const rawComment = block.sourceText.slice(start, end);
    const ownedDoc = ownedDocs.get(`${start}:${end}`);
    const owner = ownedDoc?.owner;
    const classification = classifyOwner(owner, sourceFile, typeOrmBindings);
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

    const descriptionIssue = findDescriptionIssue(rawComment);
    if (descriptionIssue) {
      issues.push({
        ...common,
        code: 'missing-chinese-description',
        descriptionLineOffset: descriptionIssue.lineOffset,
        descriptionUnit: descriptionIssue.label,
        reason: descriptionIssue.reason,
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
  const lineTerminator =
    sourceText
      .slice(removal.start, removal.end)
      .match(LINE_TERMINATOR_PATTERN)?.[0] || '';
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
      replacement: '',
      start: lineStart,
    };
  }

  const horizontalWhitespace = before.match(/[^\S\r\n]+$/u)?.[0];
  if (horizontalWhitespace) {
    return {
      end: removal.end,
      replacement: lineTerminator,
      start: removal.start - horizontalWhitespace.length,
    };
  }

  return {
    ...removal,
    replacement: lineTerminator,
  };
}

function mergeRemovals(removals) {
  const sorted = [...removals].sort((left, right) => left.start - right.start);
  const merged = [];

  for (const removal of sorted) {
    const previous = merged.at(-1);
    if (previous && removal.start <= previous.end) {
      previous.end = Math.max(previous.end, removal.end);
      previous.replacement ||= removal.replacement;
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
      removal.replacement +
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
  const tokens = getLeafTokens(sourceFile).filter(
    (node) => node.kind !== ts.SyntaxKind.EndOfFileToken,
  );

  return tokens.map((node, index) => {
    const previous = tokens[index - 1];
    const hasLineTerminator =
      previous &&
      LINE_TERMINATOR_PATTERN.test(
        sourceText.slice(previous.end, node.getStart(sourceFile)),
      );
    const tokenText = node
      .getText(sourceFile)
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n');
    return `${hasLineTerminator ? 'line-break' : 'same-line'}:${node.kind}:${tokenText}`;
  });
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

function listWorkingTreeSourceFiles(repoRoot) {
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

function listIndexSourceFiles(repoRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '-z', '--', ...SOURCE_PATHSPECS],
    {
      cwd: repoRoot,
      encoding: 'buffer',
    },
  );

  return splitNullDelimited(output).filter(isSupportedSourceFile).sort();
}

function readIndexSourceFile(repoRoot, filePath) {
  return execFileSync('git', ['show', `:${filePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
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
  readCurrentSource,
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
    if (!currentFileSet.has(filePath)) {
      mismatches.push({
        filePath,
        reason: '基线文件在当前代码快照中缺失',
      });
      continue;
    }

    const beforeSource = execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const afterSource = readCurrentSource(filePath);
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
  staged,
}) {
  if (fix && staged) {
    throw new Error('--fix 不能与 --staged 同时使用');
  }

  const files = staged
    ? listIndexSourceFiles(repoRoot)
    : listWorkingTreeSourceFiles(repoRoot);
  const readCurrentSource = staged
    ? (filePath) => readIndexSourceFile(repoRoot, filePath)
    : (filePath) => readFileSync(path.resolve(repoRoot, filePath), 'utf8');
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
    const sourceText = readCurrentSource(filePath);

    if (fix) {
      const result = fixSourceText(filePath, sourceText);
      addStats(totals, result.stats);
      removedCount += result.removedCount;
      if (result.sourceText !== sourceText) {
        writeFileSync(path.resolve(repoRoot, filePath), result.sourceText);
        changedFiles += 1;
      }
      continue;
    }

    const result = validateSourceText(filePath, sourceText);
    addStats(totals, result.stats);
    issues.push(...result.issues);
  }

  const comparison = compareRef
    ? compareRepositoryTokens(
        repoRoot,
        compareRef,
        files,
        readCurrentSource,
        allowedTokenChanges,
      )
    : undefined;
  const summary = {
    changedFiles,
    comparison,
    filesScanned: files.length,
    issues: issues.length,
    mode: fix ? 'fix' : 'check',
    removedCount,
    sourceMode: staged ? 'index' : 'worktree',
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
    staged: args.includes('--staged'),
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
