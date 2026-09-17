const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  parseWorkflowBpmn,
  validateWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const {
  advanceWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const {
  KT_BPMN_EXPRESSION,
  KT_BPMN_STEP,
} = require('../../../src/modules/workflow-engine/constants/bpmn');
const formal = (expression) => ({
  $type: 'bpmn:FormalExpression',
  language: KT_BPMN_EXPRESSION,
  body: JSON.stringify(expression),
});
const flow = (id, source, target, condition) => ({
  $type: 'bpmn:SequenceFlow',
  id,
  sourceRef: { $ref: source },
  targetRef: { $ref: target },
  ...(condition && { conditionExpression: formal(condition) }),
});
const human = (id) => ({
  $type: 'bpmn:UserTask',
  id,
  extensionElements: {
    $type: 'bpmn:ExtensionElements',
    values: [
      {
        $type: 'kt:Step',
        body: '{"kind":"human","formRef":null,"writableFields":[],"input":{}}',
      },
    ],
  },
});
const restore = (result) => JSON.parse(JSON.stringify(result.checkpoint));

/**
 * 让被测活动按自身结果决定是否进入后续人工步骤，失败路径直接结束。
 * @param subject - 被测任务或消息捕获事件。
 * @param condition - 必须读取本轮输出的顺序流条件。
 * @returns 已解析并核对结构的 JSON 流程模型。
 */
async function modelFor(
  subject,
  condition = { path: 'outputs.Source.accepted' },
) {
  const configured = { ...subject, default: { $ref: 'Rejected' } };
  const extra = [];
  let branch = 'Source';
  if (subject.$type === 'bpmn:IntermediateCatchEvent') {
    delete configured.default;
    branch = 'Decision';
    extra.push(
      {
        $type: 'bpmn:ExclusiveGateway',
        id: branch,
        default: { $ref: 'Rejected' },
      },
      flow('ToDecision', 'Source', branch),
    );
  }
  const definition = {
    format: 'bpmn20',
    model: {
      $type: 'bpmn:Definitions',
      id: 'Definitions',
      targetNamespace: 'urn:kt:output',
      rootElements: [
        {
          $type: 'bpmn:Process',
          id: 'Process',
          isExecutable: true,
          flowElements: [
            { $type: 'bpmn:StartEvent', id: 'Start' },
            configured,
            ...extra,
            human('Next'),
            { $type: 'bpmn:EndEvent', id: 'End' },
            flow('Begin', 'Start', 'Source'),
            flow('Accepted', branch, 'Next', condition),
            flow('Rejected', branch, 'End'),
            flow('Finish', 'Next', 'End'),
          ],
        },
      ],
    },
  };
  const model = await parseWorkflowBpmn(definition);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  return model;
}

test('人工结果在本节点出口条件求值前可见，后继步骤使用本轮结果', async () => {
  const model = await modelFor(human('Source'));
  for (const accepted of [true, false]) {
    let result = await advanceWorkflowBpmn(model, null, { input: {} });
    const source = result.jobs[0];
    result = await advanceWorkflowBpmn(model, restore(result), {}, [
      { executionId: source.executionId, output: { accepted } },
    ]);
    assert.equal(result.error, null);
    assert.deepEqual(
      result.jobs.map((job) => job.elementId),
      accepted ? ['Next'] : [],
    );
    assert.deepEqual(result.checkpoint.outputs.Source, { accepted });
    if (accepted)
      assert.deepEqual(result.jobs[0].variables.outputs.Source, { accepted });
  }
});

test('服务任务仍在出线之前暴露当前执行结果', async () => {
  const subject = {
    $type: 'bpmn:ServiceTask',
    id: 'Source',
    implementation: KT_BPMN_STEP,
    extensionElements: {
      $type: 'bpmn:ExtensionElements',
      values: [
        { $type: 'kt:Step', body: '{"kind":"script","scripts":[],"input":{}}' },
      ],
    },
  };
  const model = await modelFor(subject);
  let result = await advanceWorkflowBpmn(model, null, { input: {} });
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    { executionId: result.jobs[0].executionId, output: { accepted: true } },
  ]);
  assert.deepEqual(
    result.jobs.map((job) => job.elementId),
    ['Next'],
  );
});

test('标准人工循环按刚提交的结果继续或退出，恢复后不会复用上轮判断', async () => {
  const subject = {
    ...human('Source'),
    loopCharacteristics: {
      $type: 'bpmn:StandardLoopCharacteristics',
      testBefore: false,
      loopMaximum: 3,
      loopCondition: formal({ path: 'outputs.Source.again' }),
    },
  };
  const model = await modelFor(subject);
  let result = await advanceWorkflowBpmn(model, null, { input: {} });
  const first = result.jobs[0].executionId;
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    { executionId: first, output: { again: true, accepted: true } },
  ]);
  assert.deepEqual(
    result.jobs.map((job) => job.elementId),
    ['Source'],
  );
  assert.notEqual(result.jobs[0].executionId, first);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    {
      executionId: result.jobs[0].executionId,
      output: { again: false, accepted: true },
    },
  ]);
  assert.deepEqual(
    result.jobs.map((job) => job.elementId),
    ['Next'],
  );
  assert.equal(result.checkpoint.outputs.Source.again, false);
  assert.equal(result.checkpoint.outputs.Source.items.length, 2);
});

for (const type of ['bpmn:ReceiveTask', 'bpmn:IntermediateCatchEvent'])
  test(type + ' 的消息结果在出口求值前可见', async () => {
    const subject = { $type: type, id: 'Source' };
    if (type === 'bpmn:IntermediateCatchEvent')
      subject.eventDefinitions = [{ $type: 'bpmn:MessageEventDefinition' }];
    const model = await modelFor(subject);
    let result = await advanceWorkflowBpmn(model, null, { input: {} });
    const waiting = result.activeActivities.find(
      (item) => item.nodeId === 'Source',
    );
    result = await advanceWorkflowBpmn(
      model,
      restore(result),
      {},
      [],
      [
        {
          id: 'Source',
          executionId: waiting.executionId,
          workflowMessage: true,
          values: { accepted: true },
        },
      ],
    );
    assert.deepEqual(
      result.jobs.map((job) => job.elementId),
      ['Next'],
    );
    assert.deepEqual(result.jobs[0].variables.outputs.Source, {
      accepted: true,
    });
  });

test('多实例聚合结果先写入快照再判断出口，后继步骤拿到完整有序结果', async () => {
  const subject = {
    ...human('Source'),
    loopCharacteristics: {
      $type: 'bpmn:MultiInstanceLoopCharacteristics',
      isSequential: false,
      loopCardinality: formal({ value: 2 }),
    },
  };
  const model = await modelFor(subject, {
    path: 'outputs.Source.items.1.value.accepted',
  });
  let result = await advanceWorkflowBpmn(model, null, { input: {} });
  const [first, second] = result.jobs;
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    { executionId: second.executionId, output: { accepted: true, index: 1 } },
  ]);
  assert.equal(result.jobs.length, 1);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    { executionId: first.executionId, output: { accepted: false, index: 0 } },
  ]);
  assert.deepEqual(
    result.jobs.map((job) => job.elementId),
    ['Next'],
  );
  assert.deepEqual(
    result.jobs[0].variables.outputs.Source.items.map(
      (item) => item.value.index,
    ),
    [0, 1],
  );
});

test('过期的完成身份及消息身份不能污染节点输出', async () => {
  const model = await modelFor(human('Source'));
  let result = await advanceWorkflowBpmn(model, null, { input: {} });
  result = await advanceWorkflowBpmn(
    model,
    restore(result),
    {},
    [{ executionId: 'expired', output: { accepted: true } }],
    [
      {
        id: 'Source',
        executionId: 'expired',
        workflowMessage: true,
        values: { accepted: true },
      },
    ],
  );
  assert.deepEqual(result.unconsumedCompletionIds, ['expired']);
  assert.deepEqual(result.unconsumedSignalIds, ['expired']);
  assert.equal(result.checkpoint.outputs.Source, undefined);
  assert.deepEqual(
    result.jobs.map((job) => job.elementId),
    ['Source'],
  );
});

test('发布拒绝非默认出口的不支持语言、未知运算和非布尔常量，默认出口条件不求值', async () => {
  const model = await modelFor(human('Source'));
  for (const invalid of [
    { ...formal({ value: true }), language: 'javascript' },
    { ...formal({ value: true }), language: undefined },
    formal({ op: 'eval', left: { value: 1 }, right: { value: 1 } }),
    formal({ value: 1 }),
    formal({ path: 'outputs.Source.constructor' }),
  ]) {
    const definition = structuredClone(model.definition);
    definition.model.rootElements[0].flowElements.find(
      (element) => element.id === 'Accepted',
    ).conditionExpression = JSON.parse(JSON.stringify(invalid));
    const invalidModel = await parseWorkflowBpmn(definition);
    assert.ok(
      validateWorkflowBpmn(invalidModel).some(
        (issue) =>
          issue.nodeId === 'Accepted' && issue.code === 'flow-condition',
      ),
      JSON.stringify(invalid),
    );
  }
  const definition = structuredClone(model.definition);
  definition.model.rootElements[0].flowElements.find(
    (element) => element.id === 'Rejected',
  ).conditionExpression = {
    ...formal({ value: false }),
    language: 'ignored-default-language',
  };
  assert.deepEqual(
    validateWorkflowBpmn(await parseWorkflowBpmn(definition)),
    [],
  );
});
