const { performance } = require('node:perf_hooks');
const { writeFileSync } = require('node:fs');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const assert = require('node:assert/strict');
const {
  parseWorkflowBpmn,
} = require('../../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const {
  advanceWorkflowBpmn,
} = require('../../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const {
  KT_BPMN_STEP,
} = require('../../../../src/modules/workflow-engine/contract/workflow-bpmn.types');

(async () => {
  const nodes = [{ $type: 'bpmn:StartEvent', id: 'start' }];
  for (let i = 0; i < 10; i++)
    nodes.push({
      $type: 'bpmn:ServiceTask',
      id: 'task' + i,
      implementation: KT_BPMN_STEP,
      extensionElements: {
        $type: 'bpmn:ExtensionElements',
        values: [
          {
            $type: 'kt:Step',
            body: JSON.stringify({ kind: 'script', scripts: [], input: {} }),
          },
        ],
      },
    });
  nodes.push({ $type: 'bpmn:EndEvent', id: 'end' });
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
      targetNamespace: 'urn:kt:benchmark',
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
  const samples = [];
  for (let round = 0; round < 35; round++) {
    const start = performance.now();
    let result = await advanceWorkflowBpmn(model, null, { input: { round } });
    let steps = 0;
    let checkpointBytes = 0;
    while (result.jobs.length) {
      assert.equal(result.jobs.length, 1);
      const checkpoint = JSON.stringify(result.checkpoint);
      checkpointBytes += Buffer.byteLength(checkpoint);
      result = await advanceWorkflowBpmn(model, JSON.parse(checkpoint), {}, [
        { executionId: result.jobs[0].executionId, output: { accepted: true } },
      ]);
      steps++;
    }
    assert.equal(steps, 10);
    assert.equal(result.status, 'succeeded');
    if (round >= 5)
      samples.push({ runtimeMs: performance.now() - start, checkpointBytes });
  }
  const sorted = samples
    .map((sample) => sample.runtimeMs)
    .sort((a, b) => a - b);
  const result = {
    node: process.version,
    workload:
      '10个串行服务活动，每步JSON往返恢复；模型解析不计时；5轮预热30轮采样；不执行外部脚本',
    medianMs: sorted[15],
    p95Ms: sorted[28],
    samples,
  };
  writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({ medianMs: result.medianMs, p95Ms: result.p95Ms }),
  );
})();
