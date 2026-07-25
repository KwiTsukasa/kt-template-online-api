import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fixSourceText,
  getTokenSignature,
  validateSourceText,
} from './check-jsdoc-policy.mjs';

function issueCodes(sourceText, filePath = 'fixture.ts') {
  return validateSourceText(filePath, sourceText).issues.map(
    (issue) => issue.code,
  );
}

test('accepts Chinese JSDoc on explicitly named functions and methods', () => {
  const sourceText = `
/** 计算输入值。 */
function calculateValue() {}

const handler = /** 处理输入值。 */ function namedHandler() {};

class Example {
  /** 读取当前值。 */
  get value() {
    return 1;
  }

  /** 写入当前值。 */
  set value(nextValue) {}

  /** 执行业务逻辑。 */
  execute() {}
}
`;

  assert.deepEqual(issueCodes(sourceText), []);
});

test('accepts necessary technical terms inside an overall Chinese description', () => {
  const sourceText = `
/** 解析 HTTP payload 并返回 DTO。 */
function parsePayload() {}
`;

  assert.deepEqual(issueCodes(sourceText), []);
});

test('rejects English-only or tag-only JSDoc on an otherwise valid target', () => {
  const englishOnly = `
/** Parse the incoming payload. */
function parsePayload() {}
`;
  const tagOnly = `
/** @returns payload */
function readPayload() {}
`;

  assert.deepEqual(issueCodes(englishOnly), ['missing-chinese-description']);
  assert.deepEqual(issueCodes(tagOnly), ['missing-chinese-description']);
});

test('rejects setup and Nest lifecycle entry JSDoc', () => {
  const sourceText = `
class Example {
  /** 初始化依赖。 */
  setup() {}

  /** 处理模块初始化。 */
  onModuleInit() {}
}
`;

  assert.deepEqual(issueCodes(sourceText), [
    'forbidden-entry',
    'forbidden-entry',
  ]);
});

test('rejects JSDoc on forbidden declaration and expression targets', () => {
  const fixtures = [
    `
class Example {
  /** 创建实例。 */
  constructor() {}
}
`,
    `
/** 描述接口。 */
interface Example {}
`,
    `
/** 描述类型。 */
type Example = string;
`,
    `
class Example {
  /** 保存值。 */
  value = 1;
}
`,
    `
/** 保存值。 */
const value = 1;
`,
    `
const handler = /** 处理值。 */ () => true;
`,
    `
const handler = /** 处理值。 */ function () {};
`,
    `
items.map(/** 处理值。 */ () => true);
`,
    `
items.map(/** 处理值。 */ function () {});
`,
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(issueCodes(fixture), ['invalid-target']);
  }
});

test('rejects a variable-level JSDoc even when the initializer is named', () => {
  const sourceText = `
/** 处理值。 */
const handler = function namedHandler() {};
`;

  assert.deepEqual(issueCodes(sourceText), ['invalid-target']);
});

test('validates TypeScript inside Vue script blocks with AST ownership', () => {
  const sourceText = `
<template><div /></template>
<script setup lang="ts">
/** 保存值。 */
const value = 1;
</script>
<script lang="ts">
/** 计算值。 */
function calculateValue() {}
</script>
`;

  assert.deepEqual(issueCodes(sourceText, 'Fixture.vue'), ['invalid-target']);
});

test('rejects unassociated raw JSDoc without matching literal text', () => {
  const sourceText = `
const stringValue = '/** 字符串内容。 */';
const templateValue = \`/** 模板内容。 */\`;
const values = [/** 未关联的数组元素注释。 */ 1];

function calculateValue() {
  return stringValue + templateValue + values[0];
}
`;
  const beforeTokens = getTokenSignature('fixture.ts', sourceText);
  const validation = validateSourceText('fixture.ts', sourceText);
  const result = fixSourceText('fixture.ts', sourceText);

  assert.deepEqual(
    validation.issues.map((issue) => ({
      code: issue.code,
      ownerKind: issue.ownerKind,
    })),
    [{ code: 'invalid-target', ownerKind: 'UnattachedJSDoc' }],
  );
  assert.equal(result.removedCount, 1);
  assert.match(result.sourceText, /字符串内容/);
  assert.match(result.sourceText, /模板内容/);
  assert.doesNotMatch(result.sourceText, /未关联的数组元素注释/);
  assert.deepEqual(
    getTokenSignature('fixture.ts', result.sourceText),
    beforeTokens,
  );
});

test('fixes only violating JSDoc and preserves every code token', () => {
  const sourceText = `
/** Parse the value. */
function parseValue() {
  return 1;
}

/** 保存默认值。 */
const defaultValue = 1;

const callbackResult = run('case', /** 执行回调。 */
  () => true,
);

/** 计算结果。 */
function calculateResult() {
  return parseValue() + defaultValue + Number(callbackResult);
}
`;
  const beforeTokens = getTokenSignature('fixture.ts', sourceText);
  const result = fixSourceText('fixture.ts', sourceText);

  assert.equal(result.removedCount, 3);
  assert.match(result.sourceText, /计算结果/);
  assert.doesNotMatch(result.sourceText, /Parse the value|保存默认值|执行回调/);
  assert.doesNotMatch(result.sourceText, /[^\S\r\n]+\r?$/mu);
  assert.deepEqual(
    validateSourceText('fixture.ts', result.sourceText).issues,
    [],
  );
  assert.deepEqual(
    getTokenSignature('fixture.ts', result.sourceText),
    beforeTokens,
  );
});
