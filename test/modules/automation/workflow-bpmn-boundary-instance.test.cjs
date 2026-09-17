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
const flow = (source, target) => ({
  $type: 'bpmn:SequenceFlow',
  id: `${source}_${target}`,
  sourceRef: { $ref: source },
  targetRef: { $ref: target },
});
const task = (id, human = true) => ({
  $type: human ? 'bpmn:UserTask' : 'bpmn:ServiceTask',
  id,
  ...(!human && {
    implementation: 'https://kwitsukasa.top/schema/workflow/bpmn/1/step',
  }),
  extensionElements: {
    $type: 'bpmn:ExtensionElements',
    values: [
      {
        $type: 'kt:Step',
        body: JSON.stringify(
          human
            ? { kind: 'human', formRef: null, writableFields: [], input: {} }
            : { kind: 'script', scripts: [], input: {} },
        ),
      },
    ],
  },
});
const restore = (result) => JSON.parse(JSON.stringify(result.checkpoint));
const ids = (result) => result.jobs.map((job) => job.elementId).sort();
const boundaries = (result) =>
  result.activeActivities.filter((item) => item.nodeId === 'Boundary');
const finish = (model, result, jobs = result.jobs) =>
  advanceWorkflowBpmn(
    model,
    restore(result),
    {},
    jobs.map((job) => ({ executionId: job.executionId, output: {} })),
  );
const makeModel = async (
  eventDefinition,
  interrupting = true,
  human = false,
) => {
  const body = [
    { $type: 'bpmn:StartEvent', id: 'Start' },
    { $type: 'bpmn:ParallelGateway', id: 'Fork' },
    task('A'),
    task('B'),
    task('Host', human),
    task('Review'),
    { $type: 'bpmn:EndEvent', id: 'End' },
    flow('Start', 'Fork'),
    flow('Fork', 'A'),
    flow('Fork', 'B'),
    flow('A', 'Host'),
    flow('B', 'Host'),
    flow('Host', 'End'),
    {
      $type: 'bpmn:BoundaryEvent',
      id: 'Boundary',
      attachedToRef: { $ref: 'Host' },
      cancelActivity: interrupting,
      eventDefinitions: [eventDefinition],
    },
    flow('Boundary', 'Review'),
    flow('Review', 'End'),
  ];
  const model = await parseWorkflowBpmn({
    format: 'bpmn20',
    model: {
      $type: 'bpmn:Definitions',
      id: 'Definitions',
      targetNamespace: 'urn:kt:boundary-instance',
      rootElements: [
        { $type: 'bpmn:Message', id: 'Message' },
        {
          $type: 'bpmn:Process',
          id: 'Process',
          isExecutable: true,
          flowElements: body,
        },
      ],
    },
  });
  assert.deepEqual(validateWorkflowBpmn(model), []);
  return model;
};
const start = async (model) => {
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(model, result);
  assert.deepEqual(ids(result), ['Host', 'Host']);
  assert.equal(boundaries(result).length, 2);
  return result;
};
const send = (model, result, executionId) =>
  advanceWorkflowBpmn(
    model,
    restore(result),
    {},
    [],
    [{ id: 'Boundary', executionId, value: 'received' }],
  );

test('并发服务的错误边界只结束报错实例，恢复后保留另一个脚本及其错误监听', async () => {
  const model = await makeModel({ $type: 'bpmn:ErrorEventDefinition' });
  let result = await start(model);
  const [failed, survivor] = result.jobs;
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    {
      executionId: failed.executionId,
      error: { code: 'SOURCE', message: 'source rejected' },
    },
  ]);
  assert.equal(result.status, 'waiting');
  assert.deepEqual(ids(result), ['Host', 'Review']);
  assert.equal(
    result.jobs.find((job) => job.elementId === 'Host').executionId,
    survivor.executionId,
  );
  assert.ok(!result.cancelledExecutionIds.includes(survivor.executionId));
  assert.equal(boundaries(result).length, 1);
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.deepEqual(ids(result), ['Host', 'Review']);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    {
      executionId: survivor.executionId,
      error: { code: 'SOURCE', message: 'second rejected' },
    },
  ]);
  assert.deepEqual(ids(result), ['Review', 'Review']);
  assert.equal(boundaries(result).length, 0);
  result = await finish(model, result);
  assert.equal(result.status, 'succeeded');
});

for (const human of [true, false])
  test(`消息边界按准确等待身份中断一个${human ? '人工' : '脚本'}实例，过期投递不影响另一个`, async () => {
    const model = await makeModel(
      { $type: 'bpmn:MessageEventDefinition', messageRef: { $ref: 'Message' } },
      true,
      human,
    );
    let result = await start(model);
    const targets = boundaries(result);
    result = await send(model, result, targets[0].executionId);
    assert.deepEqual(ids(result), ['Host', 'Review']);
    assert.equal(result.cancelledExecutionIds.length, 1);
    assert.equal(boundaries(result).length, 1);
    assert.equal(boundaries(result)[0].executionId, targets[1].executionId);
    result = await send(model, result, targets[0].executionId);
    assert.deepEqual(result.unconsumedSignalIds, [targets[0].executionId]);
    assert.deepEqual(ids(result), ['Host', 'Review']);
    result = await finish(model, result);
    assert.equal(result.status, 'succeeded');
  });

test('非中断消息边界可以重复触发，恢复不重复创建处理任务且宿主完成后撤销监听', async () => {
  const model = await makeModel(
    { $type: 'bpmn:MessageEventDefinition', messageRef: { $ref: 'Message' } },
    false,
  );
  let result = await start(model);
  const firstTargets = boundaries(result).map((item) => item.executionId);
  result = await send(model, result, firstTargets[0]);
  assert.deepEqual(ids(result), ['Host', 'Host', 'Review']);
  assert.equal(boundaries(result).length, 2);
  const repeated = boundaries(result).find(
    (item) => !firstTargets.includes(item.executionId),
  );
  assert.ok(repeated);
  result = await send(model, result, repeated.executionId);
  assert.deepEqual(ids(result), ['Host', 'Host', 'Review', 'Review']);
  const executions = result.jobs.map((job) => job.executionId).sort();
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.deepEqual(
    result.jobs.map((job) => job.executionId).sort(),
    executions,
  );
  result = await finish(
    model,
    result,
    result.jobs.filter((job) => job.elementId === 'Host'),
  );
  assert.deepEqual(ids(result), ['Review', 'Review']);
  assert.equal(boundaries(result).length, 0);
  result = await finish(model, result);
  assert.equal(result.status, 'succeeded');
});

test('独立计时边界恢复保留期限，完成一个宿主只清除该实例计时器', async () => {
  const model = await makeModel({
    $type: 'bpmn:TimerEventDefinition',
    timeDuration: { $type: 'bpmn:FormalExpression', body: 'PT1H' },
  });
  let result = await start(model);
  const wakeAt = result.nextWakeAt;
  const executions = boundaries(result)
    .map((item) => item.executionId)
    .sort();
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.equal(result.nextWakeAt, wakeAt);
  assert.deepEqual(
    boundaries(result)
      .map((item) => item.executionId)
      .sort(),
    executions,
  );
  result = await finish(model, result, [result.jobs[0]]);
  assert.deepEqual(ids(result), ['Host']);
  assert.equal(boundaries(result).length, 1);
  assert.ok(result.nextWakeAt >= wakeAt);
  result = await finish(model, result);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.nextWakeAt, null);
});

test('没有错误边界时正常失败，不吞掉未处理错误', async () => {
  const model = await makeModel({
    $type: 'bpmn:MessageEventDefinition',
    messageRef: { $ref: 'Message' },
  });
  let result = await start(model);
  result = await advanceWorkflowBpmn(model, restore(result), {}, [
    {
      executionId: result.jobs[0].executionId,
      error: { code: 'UNHANDLED', message: 'unhandled failure' },
    },
  ]);
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'unhandled failure');
});

test('同一个信号分别触发所有活动宿主的边界，恢复不把广播变成单播或重复处理', async () => {
  const base = await makeModel(
    { $type: 'bpmn:SignalEventDefinition' },
    false,
    true,
  );
  const document = structuredClone(base.definition);
  const process = document.model.rootElements.find(
    (item) => item.$type === 'bpmn:Process',
  );
  process.flowElements.push(
    task('Trigger'),
    {
      $type: 'bpmn:IntermediateThrowEvent',
      id: 'Broadcast',
      eventDefinitions: [{ $type: 'bpmn:SignalEventDefinition' }],
    },
    flow('Fork', 'Trigger'),
    flow('Trigger', 'Broadcast'),
    flow('Broadcast', 'End'),
  );
  const model = await parseWorkflowBpmn(document);
  assert.deepEqual(validateWorkflowBpmn(model), []);
  let result = await advanceWorkflowBpmn(model, null, {});
  result = await finish(
    model,
    result,
    result.jobs.filter((job) => ['A', 'B'].includes(job.elementId)),
  );
  result = await finish(
    model,
    result,
    result.jobs.filter((job) => job.elementId === 'Trigger'),
  );
  assert.deepEqual(ids(result), ['Host', 'Host', 'Review', 'Review']);
  const executions = result.jobs.map((job) => job.executionId).sort();
  result = await advanceWorkflowBpmn(model, restore(result), {});
  assert.deepEqual(
    result.jobs.map((job) => job.executionId).sort(),
    executions,
  );
  result = await finish(model, result);
  assert.equal(result.status, 'succeeded');
});

for (const kind of ['message', 'timer', 'error'])
  test(`当前${kind}边界检查点直接恢复全部监听身份、期限且不修改输入`, async () => {
    const definitions = {
      message: {
        $type: 'bpmn:MessageEventDefinition',
        messageRef: { $ref: 'Message' },
      },
      timer: {
        $type: 'bpmn:TimerEventDefinition',
        timeDuration: { $type: 'bpmn:FormalExpression', body: 'PT1H' },
      },
      error: { $type: 'bpmn:ErrorEventDefinition' },
    };
    const model = await makeModel(definitions[kind]);
    let result = await advanceWorkflowBpmn(model, null, {});
    result = await finish(model, result);
    assert.equal(boundaries(result).length, 2);
    const originalIds = boundaries(result)
      .map((item) => item.executionId)
      .sort();
    const originalId = originalIds[0];
    const saved = restore(result);
    const serialized = JSON.stringify(saved);
    const wakeAt = result.nextWakeAt;
    result = await advanceWorkflowBpmn(model, saved, {});
    assert.equal(JSON.stringify(saved), serialized);
    assert.equal(boundaries(result).length, 2);
    assert.deepEqual(
      boundaries(result)
        .map((item) => item.executionId)
        .sort(),
      originalIds,
    );
    assert.equal(result.nextWakeAt, wakeAt);
    result = await advanceWorkflowBpmn(model, restore(result), {});
    assert.equal(boundaries(result).length, 2);
    if (kind === 'message') result = await send(model, result, originalId);
    if (kind === 'error')
      result = await advanceWorkflowBpmn(model, restore(result), {}, [
        {
          executionId: result.jobs[0].executionId,
          error: { code: 'SOURCE', message: 'current failure' },
        },
      ]);
    if (kind !== 'timer') assert.deepEqual(ids(result), ['Host', 'Review']);
    result = await finish(model, result);
    assert.equal(result.status, 'succeeded');
  });
