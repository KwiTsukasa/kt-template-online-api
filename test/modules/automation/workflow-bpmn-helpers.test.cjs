const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
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
  WorkflowBpmnFlowIndex,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn-flow-index');
const {
  workflowBpmnChildParent,
  workflowBpmnOuterParent,
  workflowBpmnParentChain,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn-scope');
const {
  requireBpmnInstanceCount,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-limits');

test('父链提升与派生不修改检查点，祖先不重复携带嵌套路径', () => {
  const top = Object.freeze({
    id: 'p',
    type: 'bpmn:Process',
    executionId: 'p1',
  });
  const parent = Object.freeze({
    id: 'sub',
    type: 'bpmn:SubProcess',
    executionId: 's1',
    path: Object.freeze([top]),
  });
  const content = Object.freeze({
    id: 'task',
    type: 'bpmn:ServiceTask',
    executionId: 't1',
    parent,
  });
  const childParent = workflowBpmnChildParent(content);
  assert.deepEqual(childParent, {
    id: 'task',
    type: 'bpmn:ServiceTask',
    executionId: 't1',
    path: [{ id: 'sub', type: 'bpmn:SubProcess', executionId: 's1' }, top],
  });
  assert.deepEqual(workflowBpmnOuterParent(childParent), parent);
  assert.deepEqual(workflowBpmnParentChain(), []);
  assert.deepEqual(workflowBpmnOuterParent(top), {});
  assert.deepEqual(workflowBpmnChildParent(top).path, []);
});

test('可达分析保留回边，网关入口分析在本轮汇合处停止', () => {
  const flow = (sourceId, targetId) => ({
    id: sourceId + targetId,
    sourceId,
    targetId,
  });
  const graph = new WorkflowBpmnFlowIndex([
    flow('A', 'B'),
    flow('B', 'G'),
    flow('G', 'C'),
    flow('C', 'G'),
    flow('G', 'A'),
    flow('X', 'Y'),
  ]);
  const { componentByNode, components } = graph.condense();
  assert.equal(componentByNode.get('A'), componentByNode.get('C'));
  assert.notEqual(componentByNode.get('A'), componentByNode.get('X'));
  assert.equal(components[componentByNode.get('A')].cyclic, true);
  assert.equal(components[componentByNode.get('X')].cyclic, false);
  assert.deepEqual(graph.originsBefore('G', ['BG']), new Set(['B', 'A', 'G']));
  assert.deepEqual(graph.originsBefore('G', ['CG']), new Set(['C', 'G']));
});

test('数量边界同时拒绝类型绕过、不安全整数与超过展开上限的值', () => {
  for (const value of [0, 1, 1000])
    assert.equal(requireBpmnInstanceCount(value), value);
  for (const value of [
    -1,
    0.5,
    1001,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    '1',
    null,
  ]) {
    assert.throws(() => requireBpmnInstanceCount(value), /多实例数量/);
  }
});

for (const serviceFirst of [false, true])
  test(`人工步骤使用检查点输入，服务前置=${serviceFirst}，恢复参数不能覆盖业务输入`, async () => {
    const step = (id, kind) => {
      let type = 'bpmn:UserTask';
      if (kind === 'script') type = 'bpmn:ServiceTask';
      return {
        $type: type,
        id,
        implementation: KT_BPMN_STEP,
        extensionElements: {
          $type: 'bpmn:ExtensionElements',
          values: [
            {
              $type: 'kt:Step',
              body: JSON.stringify({
                kind,
                formRef: null,
                writableFields: [],
                scripts: [],
                input: {},
              }),
            },
          ],
        },
      };
    };
    const nodes = [{ $type: 'bpmn:StartEvent', id: 'start' }];
    if (serviceFirst) nodes.push(step('inspect', 'script'));
    nodes.push(step('review', 'human'), { $type: 'bpmn:EndEvent', id: 'end' });
    const flows = nodes.slice(1).map((node, index) => ({
      $type: 'bpmn:SequenceFlow',
      id: 'flow' + index,
      sourceRef: { $ref: nodes[index].id },
      targetRef: { $ref: node.id },
    }));
    const model = await parseWorkflowBpmn({
      format: 'bpmn20',
      model: {
        $type: 'bpmn:Definitions',
        id: 'definition',
        targetNamespace: 'urn:kt:input',
        rootElements: [
          {
            $type: 'bpmn:Process',
            id: 'process',
            isExecutable: true,
            flowElements: [...nodes, ...flows],
          },
        ],
      },
    });
    const originalInput = { source: 'source-1', business: { revision: 1 } };
    let result = await advanceWorkflowBpmn(model, null, {
      input: originalInput,
    });
    const completions = [];
    if (serviceFirst)
      completions.push({
        executionId: result.jobs[0].executionId,
        output: { checked: true },
      });
    const resumeInput = { input: { source: 'unexpected-replacement' } };
    result = await advanceWorkflowBpmn(
      model,
      JSON.parse(JSON.stringify(result.checkpoint)),
      resumeInput,
      completions,
    );
    assert.equal(result.jobs[0].elementId, 'review');
    assert.deepEqual(result.jobs[0].variables.input, originalInput);
    assert.deepEqual(resumeInput, {
      input: { source: 'unexpected-replacement' },
    });
    const identity = result.jobs[0].executionId;
    result.jobs[0].variables.input.business.revision = 99;
    result = await advanceWorkflowBpmn(
      model,
      JSON.parse(JSON.stringify(result.checkpoint)),
      {},
    );
    assert.equal(result.jobs[0].executionId, identity);
    assert.deepEqual(result.jobs[0].variables.input, originalInput);
  });
