const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { mediaFixture } = require('./shared-design-fixture.cjs');
const {
  MEDIA_FORM,
  MEDIA_RULE,
  extractMediaDesignResources,
  isExtractedMediaDefinition,
  designResourceDigest,
} = require('../../../src/commands/automation-design-resources/model');
const {
  validateFormValues,
} = require('../../../src/modules/form-definition/domain/form.policy');
const {
  evaluateRuleDefinition,
} = require('../../../src/modules/rule-engine/domain/rule.policy');
const {
  parseWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const {
  advanceWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const {
  MediaGovernanceWorkflow,
} = require('../../../src/modules/admin/media-governance/application/media-governance.workflow');
const references = {
  form: { id: '101', version: 1 },
  rule: { id: '102', version: 1 },
};

test('公用确认表单拒绝未确认、false和业务字段，规则覆盖0/1/16和越界值', () => {
  assert.deepEqual(validateFormValues(MEDIA_FORM, { confirmed: true }), {
    confirmed: true,
  });
  for (const values of [
    {},
    { confirmed: false },
    { confirmed: true, revision: 2 },
    { confirmed: true, taskId: 'other' },
    { confirmed: true, sourceCount: 1 },
  ])
    assert.throws(() => validateFormValues(MEDIA_FORM, values));
  for (const sourceCount of [0, 1, 16])
    assert.equal(
      evaluateRuleDefinition(MEDIA_RULE, { sourceCount }).result,
      sourceCount === 0,
    );
  for (const sourceCount of [-1, 17, 0.5, '0'])
    assert.throws(() => evaluateRuleDefinition(MEDIA_RULE, { sourceCount }));
});

test('真实媒体权威回调重新读取业务事实，拒绝空来源和执行占用', async () => {
  const task = {
    id: 'task-authority',
    workId: 'work-authority',
    revision: 9,
    activeRunId: null,
    sources: [{ descriptorTombstonedAt: null }],
  };
  const workflow = new MediaGovernanceWorkflow({
    workflowTask: async () => task,
  });
  const context = {
    stepKey: 'source.review',
    business: { scopeId: 'fixture', subjectId: task.id },
    values: { confirmed: true, taskId: 'forged', revision: 1, sourceCount: 0 },
  };
  assert.deepEqual(await workflow.acceptHumanStep(context), {
    taskId: task.id,
    workId: task.workId,
    revision: 9,
    sourceCount: 1,
  });
  task.sources = [];
  await assert.rejects(workflow.acceptHumanStep(context), /请先补充媒体来源/);
  task.sources = [{ descriptorTombstonedAt: null }];
  task.activeRunId = 'busy';
  await assert.rejects(workflow.acceptHumanStep(context), /仍在执行/);
});

test('抽离图先执行真实公用规则，零来源进入人工确认，非零进入原循环检查', async () => {
  const { definition } = mediaFixture();
  const before = structuredClone(definition);
  const extracted = await extractMediaDesignResources(definition, references);
  assert.deepEqual(definition, before);
  const originalBusiness = definition.model.rootElements[0].flowElements.filter(
    (node) => node.$type === 'bpmn:ServiceTask',
  );
  assert.deepEqual(
    extracted.model.rootElements[0].flowElements.filter(
      (node) => node.$type === 'bpmn:ServiceTask',
    ),
    originalBusiness,
  );
  assert.equal(await isExtractedMediaDefinition(extracted, references), true);
  assert.equal(await isExtractedMediaDefinition(definition, references), false);
  const model = await parseWorkflowBpmn(extracted);
  for (const sourceCount of [0, 1, 16]) {
    let result = await advanceWorkflowBpmn(model, null, {
      input: { taskId: 'task', workId: 'work', revision: 1, sourceCount },
    });
    assert.equal(result.error, null);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].step.kind, 'rule');
    assert.deepEqual(result.jobs[0].step.ruleRef, references.rule);
    result = await advanceWorkflowBpmn(
      model,
      JSON.parse(JSON.stringify(result.checkpoint)),
      {},
      [
        {
          executionId: result.jobs[0].executionId,
          output: evaluateRuleDefinition(MEDIA_RULE, { sourceCount }),
        },
      ],
    );
    assert.equal(result.error, null);
    if (sourceCount === 0) {
      assert.equal(result.jobs[0].elementId, 'SourceReview');
      assert.deepEqual(result.jobs[0].step.formRef, references.form);
      assert.deepEqual(result.jobs[0].step.writableFields, ['confirmed']);
    } else assert.equal(result.jobs[0].elementId, 'Inspect');
  }
  assert.equal(
    designResourceDigest({ a: 1, b: { x: 2, y: 3 } }),
    designResourceDigest({ b: { y: 3, x: 2 }, a: 1 }),
  );
});

test('未知分支、人工字段、绕行和已迁移引用漂移均拒绝转换', async () => {
  const mutations = [
    (model) => {
      model.rootElements[0].flowElements.find(
        (node) => node.id === 'Missing',
      ).conditionExpression.body = JSON.stringify({
        op: 'gt',
        left: { path: 'input.sourceCount' },
        right: { value: 0 },
      });
    },
    (model) => {
      model.rootElements[0].flowElements.find(
        (node) => node.id === 'Entry',
      ).sourceRef = { $ref: 'Inspect' };
    },
    (model) => {
      model.rootElements[0].flowElements.push({
        $type: 'bpmn:SequenceFlow',
        id: 'Bypass',
        sourceRef: { $ref: 'Start' },
        targetRef: { $ref: 'Inspect' },
      });
    },
    (model) => {
      model.rootElements[0].flowElements.find(
        (node) => node.id === 'SourceReview',
      ).extensionElements.values[0].body = JSON.stringify({
        kind: 'human',
        businessKey: 'source.review',
        formRef: references.form,
        writableFields: ['confirmed'],
        input: {},
      });
    },
  ];
  for (const mutation of mutations) {
    const { definition } = mediaFixture();
    mutation(definition.model);
    await assert.rejects(extractMediaDesignResources(definition, references));
  }
  const extracted = await extractMediaDesignResources(
    mediaFixture().definition,
    references,
  );
  const human = extracted.model.rootElements[0].flowElements.find(
    (node) => node.id === 'SourceReview',
  );
  const step = JSON.parse(human.extensionElements.values[0].body);
  step.formRef.version = 2;
  human.extensionElements.values[0].body = JSON.stringify(step);
  await assert.rejects(
    isExtractedMediaDefinition(extracted, references),
    /表单引用/,
  );
});
