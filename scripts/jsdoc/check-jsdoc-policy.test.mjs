import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  fixSourceText,
  getTokenSignature,
  validateSourceText,
} from './check-jsdoc-policy.mjs';

const CHECKER_PATH = fileURLToPath(
  new URL('./check-jsdoc-policy.mjs', import.meta.url),
);
const HOOK_CHECK_PATH = fileURLToPath(
  new URL('../husky-fast-check.mjs', import.meta.url),
);

function issueCodes(sourceText, filePath = 'fixture.ts') {
  return validateSourceText(filePath, sourceText).issues.map(
    (issue) => issue.code,
  );
}

function createIsolatedGitEnvironment(sourceEnvironment = process.env) {
  const environment = Object.fromEntries(
    Object.entries(sourceEnvironment).filter(
      ([name]) => !name.startsWith('GIT_'),
    ),
  );

  return {
    ...environment,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

function executeGit(
  repositoryPath,
  args,
  { environment = process.env, gitEnvironment = {} } = {},
) {
  return execFileSync('git', args, {
    cwd: repositoryPath,
    encoding: 'utf8',
    env: {
      ...createIsolatedGitEnvironment(environment),
      ...gitEnvironment,
    },
  });
}

function createFixtureRepository(sourceEnvironment = process.env) {
  const repositoryPath = mkdtempSync(path.join(tmpdir(), 'kt-jsdoc-policy-'));
  const validSource = '/** 解析输入。 */\nfunction parseInput() {}\n';

  executeGit(repositoryPath, ['init', '--quiet'], {
    environment: sourceEnvironment,
  });
  executeGit(repositoryPath, ['config', 'user.email', 'codex@example.test'], {
    environment: sourceEnvironment,
  });
  executeGit(repositoryPath, ['config', 'user.name', 'Codex Test'], {
    environment: sourceEnvironment,
  });
  writeFileSync(path.join(repositoryPath, 'fixture.ts'), validSource);
  writeFileSync(
    path.join(repositoryPath, 'deleted.ts'),
    '/** 读取输入。 */\nfunction readInput() {}\n',
  );
  executeGit(repositoryPath, ['add', 'fixture.ts', 'deleted.ts'], {
    environment: sourceEnvironment,
  });
  executeGit(
    repositoryPath,
    ['-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'fixture'],
    { environment: sourceEnvironment },
  );

  return {
    repositoryPath,
    validSource,
  };
}

function runChecker(
  repositoryPath,
  args,
  { gitEnvironment = {}, sourceEnvironment = process.env } = {},
) {
  return spawnSync(
    process.execPath,
    [CHECKER_PATH, '--repo-root', repositoryPath, ...args],
    {
      cwd: repositoryPath,
      encoding: 'utf8',
      env: {
        ...createIsolatedGitEnvironment(sourceEnvironment),
        ...gitEnvironment,
      },
    },
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

test('rejects every imported TypeORM entity listener decorator', () => {
  const listenerDecorators = [
    'AfterLoad',
    'BeforeInsert',
    'AfterInsert',
    'BeforeUpdate',
    'AfterUpdate',
    'BeforeRemove',
    'AfterRemove',
    'BeforeSoftRemove',
    'AfterSoftRemove',
    'BeforeRecover',
    'AfterRecover',
  ];
  const methods = listenerDecorators
    .map(
      (decoratorName, index) => `
  /** 处理实体监听事件。 */
  @${decoratorName}()
  handleEntityEvent${index}() {}
`,
    )
    .join('');
  const sourceText = `
import { ${listenerDecorators.join(', ')} } from 'typeorm';

class Example {
${methods}
}
`;

  assert.deepEqual(
    issueCodes(sourceText),
    listenerDecorators.map(() => 'forbidden-entry'),
  );
});

test('recognizes aliased and namespace TypeORM listeners without rejecting ordinary same-name methods', () => {
  const decoratedSource = `
import { BeforeInsert as PersistEntity } from 'typeorm';
import * as TypeOrm from 'typeorm';

class EntityExample {
  /** 持久化实体。 */
  @PersistEntity()
  persist() {}

  /** 加载实体。 */
  @TypeOrm.AfterLoad()
  hydrate() {}
}
`;
  const ordinarySource = `
class OrdinaryExample {
  /** 执行业务前置处理。 */
  beforeInsert() {}

  /** 执行业务加载处理。 */
  afterLoad() {}
}
`;

  assert.deepEqual(issueCodes(decoratedSource), [
    'forbidden-entry',
    'forbidden-entry',
  ]);
  assert.deepEqual(issueCodes(ordinarySource), []);
});

test('rejects English prose in each main or tag description unit', () => {
  const fixtures = [
    `
/** 参数 Parse the entire incoming HTTP payload before dispatch. */
function parsePayload() {}
`,
    `
/**
 * 清理登录运行态。
 * @param options - Cleanup switches that may revisit provisional rows.
 * @returns 清理结果。
 */
function cleanupRuntime(options) {}
`,
    `
/**
 * 格式化计数。
 * @param value - 原始计数。
 * @returns Counter text such as \`7890\` or \`12.3万\`.
 */
function formatCounter(value) {}
`,
    `
/**
 * Parse the entire incoming payload before dispatch.
 * @example
 * const 参数 = readPayload();
 */
function readPayload() {}
`,
    `
/**
 * 中文说明。
 * Asynchronously handle the login process.
 */
function handleLogin() {}
`,
    `
/** 中文引子。 Determine whether there is permission from the user role. */
function determinePermission() {}
`,
    `
/** 中文，the payload is returned by the API. */
function returnPayload() {}
`,
    `
/** 中 Returns payload. */
function readShortPayload() {}
`,
    `
/** Get machine-readable API runtime health。 */
function getRuntimeHealth() {}
`,
    `
/**
 * 查询结果。
 * @returns payload
 */
function readResult() {}
`,
    `
/**
 * 查询字段。
 * @param fields record
 */
function readFields(fields) {}
`,
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(issueCodes(fixture), ['missing-chinese-description']);
  }

  const tagIssue = validateSourceText('fixture.ts', fixtures[1]).issues[0];
  assert.equal(tagIssue.line, 2);
  assert.match(tagIssue.reason, /@param/u);
});

test('allows masked code, URLs, identifiers, and necessary technical terms inside Chinese units', () => {
  const fixtures = [
    `
/**
 * 解析 HTTP payload，并把 userId 写入 MySQL DTO。
 * @param payload - HTTP payload 输入。
 * @returns MySQL DTO 结果。
 * @see https://example.test/payload
 * @example
 * const 参数 = \`HTTP payload\`;
 */
function parsePayload(payload) {}
`,
    `
/**
 * 解析请求：
 * HTTP payload
 * 并返回 DTO。
 */
function parseTechnicalContinuation() {}
`,
    `
/** 设置 Dict Decode Cache。 */
function setDictDecodeCache() {}
`,
    `
/** 创建 Markdown code fence 到 Argon 代码块 DOM 的 rehype 转换插件。 */
function createMarkdownPlugin() {}
`,
    `
/**
 * 读取文件。
 * @returns Blob
 */
function readBlob() {}
`,
    `
/**
 * 请求文件。
 * @returns RequestResponse<Blob>
 */
function requestBlob() {}
`,
    `
/**
 * 查询角色。
 * @param roles
 */
function readRoles(roles) {}
`,
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(issueCodes(fixture), []);
  }
});

test('treats inline code and structural tags as neutral while validating custom and marker tag prose', () => {
  const validSource = `
/**
 * {@code 中文变量}
 * @custom 中文扩展说明。
 * @public
 * @author Jane Doe
 * @type {Record<string, unknown>}
 * @returns RequestResponse<Blob>
 */
function authenticate() {}
`;
  const invalidCustomSource = `
/**
 * 执行载荷检查。
 * @custom payload {@code 中文变量}
 */
function checkPayload() {}
`;
  const invalidMarkerSource = `
/**
 * 执行公开接口检查。
 * @public Public API access is enabled.
 */
function checkPublicApi() {}
`;

  assert.deepEqual(issueCodes(validSource), []);

  const customIssue = validateSourceText('fixture.ts', invalidCustomSource)
    .issues[0];
  assert.equal(customIssue?.code, 'missing-chinese-description');
  assert.match(customIssue?.reason || '', /@custom/u);

  const markerIssue = validateSourceText('fixture.ts', invalidMarkerSource)
    .issues[0];
  assert.equal(markerIssue?.code, 'missing-chinese-description');
  assert.match(markerIssue?.reason || '', /@public/u);
});

test('validates prose after structural tag payloads', () => {
  const validSource = `
/**
 * 创建选项类型。
 * @typedef {object} Options - 选项说明。
 * @extends {Base} - 基类说明。
 */
function createOptions() {}
`;
  const invalidSource = `
/**
 * 创建选项类型。
 * @typedef {object} Options - This is English prose.
 */
function createOptions() {}
`;

  assert.deepEqual(issueCodes(validSource), []);

  const issue = validateSourceText('fixture.ts', invalidSource).issues[0];
  assert.equal(issue?.code, 'missing-chinese-description');
  assert.match(issue?.reason || '', /@typedef/u);
});

test('does not parse fenced code or example decorators as description tags', () => {
  const sourceText = `
/**
 * 展示装饰器示例。
 * \`\`\`ts
 * @returns payload
 * \`\`\`
 * @example
 * @Component
 * class Demo {}
 */
function showDecoratorExample() {}
`;

  assert.deepEqual(issueCodes(sourceText), []);
});

test('does not share a Chinese anchor across main-description paragraphs', () => {
  const invalidSource = `
/**
 * 中文说明。
 *
 * Cache expires tomorrow.
 */
function readCache() {}
`;
  const validSource = `
/**
 * 解析载荷。
 * HTTP payload
 * 并返回结果。
 */
function readPayload() {}
`;

  assert.deepEqual(issueCodes(invalidSource), ['missing-chinese-description']);
  assert.deepEqual(issueCodes(validSource), []);
});

test('uses property roles for setup and lifecycle function expressions', () => {
  const sourceText = `
const component = {
  mounted: /** 组件挂载入口。 */ function mountedHook() {},
  setup: /** 组件初始化入口。 */ function namedSetup() {},
  ['mounted']: /** 计算属性挂载入口。 */ function computedMountedHook() {},
  ['setup']: /** 计算属性初始化入口。 */ function computedSetup() {},
  updated: (/** 括号包裹的更新入口。 */ function updatedHook() {}),
  task: /** 执行普通任务。 */ function namedTask() {},
  ['computedTask']: /** 执行普通计算属性任务。 */ function computedTask() {},
};

/** 读取普通同名函数。 */
function mounted() {}
`;
  const issues = validateSourceText('fixture.ts', sourceText).issues;

  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      'forbidden-entry',
      'forbidden-entry',
      'forbidden-entry',
      'forbidden-entry',
      'forbidden-entry',
    ],
  );
  assert.deepEqual(
    issues.map(({ ownerName, reason }) => [ownerName, reason]),
    [
      ['mountedHook', 'mounted 是禁止使用 JSDoc 的 setup 或生命周期入口'],
      ['namedSetup', 'setup 是禁止使用 JSDoc 的 setup 或生命周期入口'],
      [
        'computedMountedHook',
        'mounted 是禁止使用 JSDoc 的 setup 或生命周期入口',
      ],
      ['computedSetup', 'setup 是禁止使用 JSDoc 的 setup 或生命周期入口'],
      ['updatedHook', 'updated 是禁止使用 JSDoc 的 setup 或生命周期入口'],
    ],
  );
});

test('allows ordinary same-name named functions outside entry roles', () => {
  const sourceText = `
/** 执行普通初始化任务。 */
function setup() {}

const setupTask =
  /** 执行普通具名函数表达式。 */
  function setup() {};

const mountedTask =
  /** 执行普通具名函数表达式。 */
  function mounted() {};

consume(
  /** 执行普通具名回调。 */
  function onModuleInit() {},
);
`;

  assert.deepEqual(issueCodes(sourceText), []);
});

test('uses class property roles for setup and lifecycle function expressions', () => {
  const sourceText = `
class ComponentFields {
  setup =
    /** 组件初始化类字段入口。 */
    function setupField() {};

  static mounted =
    /** 组件挂载类字段入口。 */
    function mountedField() {};

  task =
    /** 执行普通类字段任务。 */
    function setup() {};
}
`;
  const issues = validateSourceText('fixture.ts', sourceText).issues;

  assert.deepEqual(
    issues.map(({ code, ownerName }) => [code, ownerName]),
    [
      ['forbidden-entry', 'setupField'],
      ['forbidden-entry', 'mountedField'],
    ],
  );
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

test('preserves LineTerminator-sensitive return semantics while fixing multiline JSDoc', () => {
  const sourceText = `
function readValue() {
  return /** English-only
   * comment.
   */ 1;
}
`;
  const unsafeSourceText = sourceText.replace(
    '/** English-only\n   * comment.\n   */',
    '',
  );
  const beforeTokens = getTokenSignature('fixture.ts', sourceText);
  const result = fixSourceText('fixture.ts', sourceText);
  const evaluate = (text) => Function(`${text}\nreturn readValue();`)();

  assert.notDeepEqual(
    getTokenSignature('fixture.ts', unsafeSourceText),
    beforeTokens,
  );
  assert.equal(evaluate(sourceText), undefined);
  assert.equal(evaluate(result.sourceText), undefined);
  assert.match(result.sourceText, /return[^\S\r\n]*\r?\n[^\S\r\n]*1/u);
  assert.deepEqual(
    getTokenSignature('fixture.ts', result.sourceText),
    beforeTokens,
  );
});

test('treats LF and CRLF as the same LineTerminator boundary', () => {
  const sourceText = `
function readValue() {
  return
    \`line one
line two\`;
}
`;

  assert.deepEqual(
    getTokenSignature('fixture.ts', sourceText.replaceAll('\n', '\r\n')),
    getTokenSignature('fixture.ts', sourceText),
  );
});

test('staged mode reads additions, modifications, and deletions from the index', () => {
  const { repositoryPath, validSource } = createFixtureRepository();
  const invalidSource =
    '/** Parse the entire incoming payload. */\nfunction parseInput() {}\n';

  try {
    writeFileSync(path.join(repositoryPath, 'fixture.ts'), invalidSource);
    executeGit(repositoryPath, ['add', 'fixture.ts']);
    writeFileSync(path.join(repositoryPath, 'fixture.ts'), validSource);

    const invalidIndexResult = runChecker(repositoryPath, ['--staged']);
    assert.equal(invalidIndexResult.status, 1);
    assert.match(invalidIndexResult.stderr, /missing-chinese-description/u);

    executeGit(repositoryPath, ['add', 'fixture.ts']);
    writeFileSync(path.join(repositoryPath, 'fixture.ts'), invalidSource);

    const invalidWorktreeResult = runChecker(repositoryPath, ['--staged']);
    assert.equal(invalidWorktreeResult.status, 0);

    writeFileSync(path.join(repositoryPath, 'added.ts'), invalidSource);
    executeGit(repositoryPath, ['add', 'added.ts']);
    writeFileSync(
      path.join(repositoryPath, 'added.ts'),
      '/** 解析新增输入。 */\nfunction parseAddedInput() {}\n',
    );

    const invalidAdditionResult = runChecker(repositoryPath, ['--staged']);
    assert.equal(invalidAdditionResult.status, 1);

    executeGit(repositoryPath, ['add', 'added.ts']);
    executeGit(repositoryPath, ['rm', '--quiet', 'deleted.ts']);
    writeFileSync(path.join(repositoryPath, 'untracked.ts'), invalidSource);

    const deletionAndUntrackedResult = runChecker(repositoryPath, ['--staged']);
    assert.equal(deletionAndUntrackedResult.status, 0);
    assert.match(deletionAndUntrackedResult.stdout, /"sourceMode": "index"/u);
  } finally {
    rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test('worktree mode ignores tracked source files deleted before staging', () => {
  const { repositoryPath } = createFixtureRepository();

  try {
    rmSync(path.join(repositoryPath, 'deleted.ts'));

    const result = runChecker(repositoryPath, []);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /"sourceMode": "worktree"/u);
  } finally {
    rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test('staged mode honors the active GIT_INDEX_FILE used by the commit', () => {
  const { repositoryPath, validSource } = createFixtureRepository();
  const alternateIndexPath = path.join(repositoryPath, '.git', 'commit-index');
  const invalidSource =
    '/** Parse the commit index payload. */\nfunction parseInput() {}\n';
  const alternateIndexEnvironment = {
    GIT_INDEX_FILE: alternateIndexPath,
  };

  try {
    executeGit(repositoryPath, ['read-tree', 'HEAD'], {
      gitEnvironment: alternateIndexEnvironment,
    });
    writeFileSync(path.join(repositoryPath, 'fixture.ts'), invalidSource);
    executeGit(repositoryPath, ['add', 'fixture.ts'], {
      gitEnvironment: alternateIndexEnvironment,
    });
    writeFileSync(path.join(repositoryPath, 'fixture.ts'), validSource);

    assert.equal(runChecker(repositoryPath, ['--staged']).status, 0);

    const commitIndexResult = runChecker(repositoryPath, ['--staged'], {
      gitEnvironment: alternateIndexEnvironment,
    });
    assert.equal(commitIndexResult.status, 1);
    assert.match(commitIndexResult.stderr, /missing-chinese-description/u);
  } finally {
    rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test('fixture Git commands isolate hostile inherited GIT variables from the parent repository', () => {
  const parentRepositoryPath = executeGit(process.cwd(), [
    'rev-parse',
    '--show-toplevel',
  ]).trim();
  const parentGitDirectory = executeGit(parentRepositoryPath, [
    'rev-parse',
    '--absolute-git-dir',
  ]).trim();
  const snapshotParent = () => ({
    config: readFileSync(path.join(parentGitDirectory, 'config'), 'utf8'),
    head: executeGit(parentRepositoryPath, ['rev-parse', 'HEAD']).trim(),
    headReference: readFileSync(path.join(parentGitDirectory, 'HEAD'), 'utf8'),
    index: readFileSync(path.join(parentGitDirectory, 'index')).toString(
      'base64',
    ),
    status: executeGit(parentRepositoryPath, [
      'status',
      '--porcelain=v2',
      '-z',
    ]),
  });
  const before = snapshotParent();
  const hostileEnvironment = {
    ...process.env,
    GIT_DIR: parentGitDirectory,
    GIT_INDEX_FILE: path.join(parentGitDirectory, 'index'),
    GIT_WORK_TREE: parentRepositoryPath,
  };
  const { repositoryPath } = createFixtureRepository(hostileEnvironment);

  try {
    assert.deepEqual(snapshotParent(), before);
  } finally {
    rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test('pre-commit invokes the JSDoc checker in staged mode', () => {
  const hookSource = readFileSync(HOOK_CHECK_PATH, 'utf8');

  assert.match(
    hookSource,
    /run\(getPnpmCommand\(\), \['run', 'check:jsdoc', '--', '--staged'\]\)/u,
  );
});
