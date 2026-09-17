const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  normalizeBindings,
  bindWorkflowValues,
} = require('../../../src/modules/workflow-engine/domain/workflow-value-binding.policy');
const {
  parseWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const {
  advanceWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const {
  KT_BPMN_STEP,
} = require('../../../src/modules/workflow-engine/constants/bpmn');
const {
  bpmnCardinalityBinding,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-expression');

const bindings = {
  revision: {
    type: 'first',
    sources: [
      { type: 'node', nodeId: 'inspect', field: 'revision' },
      { type: 'input', field: 'revision' },
    ],
  },
  sourceIndex: { type: 'iteration' },
};

test('次数发布校验拒绝空字段和隐式类型转换，保留标准数字文本', () => {
  assert.deepEqual(bpmnCardinalityBinding('3'), { type: 'literal', value: 3 });
  assert.deepEqual(bpmnCardinalityBinding('{"path":"input.count"}'), {
    type: 'input',
    field: 'count',
  });
  for (const value of [
    '',
    'null',
    'true',
    '"2"',
    '{"value":""}',
    '{"path":"input."}',
    '{"op":"coalesce","values":[]}',
    '{"path":"outputs.a.__proto__"}',
  ])
    assert.throws(() => bpmnCardinalityBinding(value));
});
const progress = (outputs) =>
  new Map(
    Object.entries(outputs).map(([id, output]) => [
      id,
      { status: 'succeeded', output },
    ]),
  );
const model = (count) =>
  parseWorkflowBpmn({
    format: 'bpmn20',
    model: {
      $type: 'bpmn:Definitions',
      id: 'd',
      targetNamespace: 'urn:kt:binding',
      rootElements: [
        {
          $type: 'bpmn:Process',
          id: 'p',
          isExecutable: true,
          flowElements: [
            { $type: 'bpmn:StartEvent', id: 's' },
            {
              $type: 'bpmn:ServiceTask',
              id: 'inspect',
              implementation: KT_BPMN_STEP,
              extensionElements: {
                $type: 'bpmn:ExtensionElements',
                values: [
                  {
                    $type: 'kt:Step',
                    body: JSON.stringify({
                      kind: 'business',
                      stepKey: 'source.inspect',
                      input: bindings,
                      scripts: [],
                    }),
                  },
                ],
              },
              loopCharacteristics: {
                $type: 'bpmn:MultiInstanceLoopCharacteristics',
                isSequential: true,
                loopCardinality: {
                  $type: 'bpmn:FormalExpression',
                  body: JSON.stringify(count),
                },
              },
            },
            { $type: 'bpmn:EndEvent', id: 'e' },
            {
              $type: 'bpmn:SequenceFlow',
              id: 'f1',
              sourceRef: { $ref: 's' },
              targetRef: { $ref: 'inspect' },
            },
            {
              $type: 'bpmn:SequenceFlow',
              id: 'f2',
              sourceRef: { $ref: 'inspect' },
              targetRef: { $ref: 'e' },
            },
          ],
        },
      ],
    },
  });

test('优先映射首轮回退输入，后续消费最近已完成轮次；零和假不触发回退', () => {
  assert.deepEqual(normalizeBindings(bindings), bindings);
  assert.deepEqual(
    bindWorkflowValues(bindings, { revision: 1 }, new Map(), 0),
    { revision: 1, sourceIndex: 1 },
  );
  assert.deepEqual(
    bindWorkflowValues(
      bindings,
      { revision: 1 },
      progress({ inspect: { revision: 3 } }),
      1,
    ),
    { revision: 3, sourceIndex: 2 },
  );
  const picks = {
    zero: {
      type: 'first',
      sources: [
        { type: 'input', field: 'zero' },
        { type: 'input', field: 'fallback' },
      ],
    },
    flag: {
      type: 'first',
      sources: [
        { type: 'input', field: 'flag' },
        { type: 'input', field: 'fallback' },
      ],
    },
  };
  assert.deepEqual(
    bindWorkflowValues(
      picks,
      { zero: 0, flag: false, fallback: 99 },
      new Map(),
    ),
    { zero: 0, flag: false },
  );
  assert.throws(() => bindWorkflowValues(bindings, {}, new Map()), /循环序号/);
  assert.throws(
    () =>
      normalizeBindings({
        x: { type: 'first', sources: [{ type: 'first', sources: [] }] },
      }),
    /只能引用/,
  );
  assert.throws(
    () =>
      normalizeBindings({
        x: { type: 'first', sources: [{ type: 'input', field: '__proto__' }] },
      }),
    /不合法/,
  );
});

test('动态顺序多实例跨快照恢复仍逐个取得序号与上轮修订', async () => {
  const definition = await model({
    op: 'coalesce',
    values: [{ path: 'outputs.review.count' }, { path: 'input.count' }],
  });
  let transition = await advanceWorkflowBpmn(definition, null, {
    input: { count: 3, revision: 1 },
  });
  const received = [];
  for (let index = 0; index < 3; index++) {
    assert.equal(transition.jobs.length, 1);
    let job = transition.jobs[0];
    const before = job.executionId;
    transition = await advanceWorkflowBpmn(
      definition,
      JSON.parse(JSON.stringify(transition.checkpoint)),
      {},
    );
    job = transition.jobs[0];
    assert.equal(job.executionId, before);
    const input = bindWorkflowValues(
      job.step.input,
      job.variables.input,
      progress(job.variables.outputs),
      job.index,
    );
    received.push(input);
    transition = await advanceWorkflowBpmn(
      definition,
      transition.checkpoint,
      {},
      [
        {
          executionId: job.executionId,
          output: { revision: input.revision + 1 },
        },
      ],
    );
  }
  assert.deepEqual(received, [
    { revision: 1, sourceIndex: 1 },
    { revision: 2, sourceIndex: 2 },
    { revision: 3, sourceIndex: 3 },
  ]);
  assert.equal(transition.status, 'succeeded');
  assert.equal(transition.checkpoint.outputs.inspect.revision, 4);
  assert.equal(transition.checkpoint.outputs.inspect.items.length, 3);
});

test('动态实例数量在展开前拒绝超限与非整数', async () => {
  for (const count of [1001, -1, 1.5, null, '', true, '2']) {
    const definition = await model({ path: 'input.count' });
    const result = await advanceWorkflowBpmn(definition, null, {
      input: { count },
    });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /一千/);
    assert.equal(result.jobs.length, 0);
  }
});
test('字段引用沿用标准节点身份，点号和 Unicode 名称不会在绑定层被误拆或拒绝', () => {
  for (const nodeId of ['source.inspect', '任务.检查']) {
    const input = { value: { type: 'node', nodeId, field: 'value' } };
    const normalized = normalizeBindings(input);
    assert.deepEqual(normalized, input);
    assert.deepEqual(
      bindWorkflowValues(
        normalized,
        {},
        new Map([[nodeId, { status: 'succeeded', output: { value: 3 } }]]),
      ),
      { value: 3 },
    );
  }
});
test('标准节点名使用无歧义路径参与条件和动态次数，普通路径字节保持不变', () => {
  const {
    bpmnPath,
    bpmnPathParts,
  } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-path');
  const {
    evaluateBpmnExpression,
    bpmnConditionType,
  } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-expression');
  assert.equal(bpmnPath(['input', 'count']), 'input.count');
  const path = bpmnPath(['outputs', '来源.检查', 'count']);
  assert.equal(path, '/outputs/来源.检查/count');
  assert.deepEqual(bpmnCardinalityBinding(JSON.stringify({ path })), {
    type: 'node',
    nodeId: '来源.检查',
    field: 'count',
  });
  assert.equal(
    evaluateBpmnExpression(
      { path },
      { outputs: { '来源.检查': { count: 3 } } },
    ),
    3,
  );
  const gateway = bpmnPath(['content', 'activationCount', '入边.一']);
  assert.equal(
    bpmnConditionType(
      { op: 'gt', left: { path: gateway }, right: { value: 0 } },
      { [gateway]: 'number' },
    ),
    'boolean',
  );
  for (const invalid of [
    '/outputs/__proto__/count',
    '/unknown/field',
    '/outputs/bad~2/value',
    '/input/',
  ])
    assert.throws(() => bpmnPathParts(invalid));
});
