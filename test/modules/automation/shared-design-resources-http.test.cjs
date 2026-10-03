const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  startSharedDesignFixture,
} = require('./shared-design-http-fixture.cjs');

test(
  '真实Nest HTTP公用资源可读取和校验，工作流与待办均引用迁移固定版本',
  { skip: !process.env.KT_AUTOMATION_TEST_DB, timeout: 90000 },
  async () => {
    const fixture = await startSharedDesignFixture({
      artifactRoot: process.env.WORKFLOW_RUNTIME_TEST_ROOT,
      port: 48086,
    });
    try {
      const request = async (route, body, status = 200) => {
        const response = await fetch(fixture.identity.base + route, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        const value = await response.json();
        assert.equal(response.status, status, JSON.stringify(value));
        return value.data;
      };
      const forms = await request(
        '/automation/forms/page?pageNo=1&pageSize=20',
      );
      const rules = await request(
        '/automation/rules/page?pageNo=1&pageSize=20',
      );
      assert.equal(forms.total, 1);
      assert.equal(rules.total, 1);
      assert.equal(forms.list[0].name, '媒体来源资料确认');
      assert.equal(rules.list[0].name, '媒体来源补充判断');
      const rule = rules.list[0].definition;
      for (const sourceCount of [0, 1, 16]) {
        const evaluation = await request('/automation/rules/preview', {
          definition: rule,
          facts: { sourceCount },
        });
        assert.equal(evaluation.result, sourceCount === 0);
        assert.equal(
          evaluation.cases.every((item) => item.passed),
          true,
        );
      }
      await request(
        '/automation/forms/preview',
        { definition: forms.list[0].definition, values: { confirmed: false } },
        400,
      );
      await request(
        '/automation/forms/preview',
        {
          definition: forms.list[0].definition,
          values: { confirmed: true, revision: 1 },
        },
        400,
      );
      const pending = await request(
        '/media-governance/tasks/fixture-task/workflow/human-tasks',
      );
      assert.deepEqual(pending[0].formRef, fixture.plan.resources.form);
      assert.deepEqual(pending[0].writableFields, ['confirmed']);
      await request(
        '/media-governance/tasks/fixture-task/workflow/human-tasks/complete',
        { ...fixture.identity, values: { confirmed: true } },
        400,
      );
      for (const values of [
        {},
        { confirmed: false },
        { confirmed: true, taskId: 'forged' },
      ])
        await request(
          '/media-governance/tasks/fixture-task/workflow/human-tasks/complete',
          {
            runId: fixture.identity.runId,
            executionId: fixture.identity.executionId,
            values,
          },
          400,
        );
      await request(
        '/media-governance/tasks/fixture-task/workflow/fixture/source-ready',
        {},
      );
      await request(
        '/media-governance/tasks/fixture-task/workflow/human-tasks/complete',
        {
          runId: fixture.identity.runId,
          executionId: fixture.identity.executionId,
          values: { confirmed: true },
        },
      );
      assert.deepEqual(
        await request(
          '/media-governance/tasks/fixture-task/workflow/human-tasks',
        ),
        [],
      );
      const schema = await request(
        `/automation/workflows/runs/${fixture.identity.runId}/schema`,
      );
      const tasks = schema.definition.model.rootElements[0].flowElements;
      assert.ok(tasks.some((node) => node.$type === 'bpmn:BusinessRuleTask'));
      const run = await request(
        `/automation/workflows/runs/${fixture.identity.runId}`,
      );
      assert.equal(run.workflowVersion, 3);
    } finally {
      await fixture.close();
    }
  },
);
