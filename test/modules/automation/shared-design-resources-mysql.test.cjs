const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  previewDesignResourceExtraction,
  applyDesignResourceExtraction,
} = require('../../../src/commands/automation-design-resources/migration');
const {
  openFixtureDatabase,
  seedOriginal,
  fixtureServices,
  seedHumanRun,
} = require('./shared-design-mysql-fixture.cjs');

test(
  '真实MySQL预演零写、草稿/身份/CAS漂移拒绝、事务失败回滚、旧版实例保留与重复幂等',
  { skip: !process.env.KT_AUTOMATION_TEST_DB, timeout: 90000 },
  async () => {
    const root = process.env.WORKFLOW_RUNTIME_TEST_ROOT;
    assert.ok(root && path.isAbsolute(root) && root.includes('.kt-workspace'));
    const { connection, datasource } = await openFixtureDatabase();
    try {
      const fixture = await seedOriginal(connection);
      const services = fixtureServices(datasource, fixture);
      const old = await seedHumanRun(
        datasource,
        services,
        fixture.workflowId,
        1,
      );
      const [oldRows] = await connection.query(
        'SELECT * FROM automation_workflow_run WHERE id=?',
        [old.runId],
      );
      const [oldVersions] = await connection.query(
        'SELECT * FROM automation_workflow_revision ORDER BY version',
      );
      const options = {
        databaseName: process.env.KT_AUTOMATION_TEST_DB,
        serverUuid: process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID,
        backupDirectory: path.join(root, 'migration-backups'),
      };
      const counts = async () => {
        const [rows] = await connection.query(
          'SELECT (SELECT COUNT(*) FROM automation_form) forms,(SELECT COUNT(*) FROM automation_ruleset) rules,(SELECT COUNT(*) FROM automation_workflow_revision) versions',
        );
        return Object.fromEntries(
          Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]),
        );
      };
      const plan = await previewDesignResourceExtraction(connection);
      assert.equal(plan.status, 'ready');
      assert.deepEqual(await counts(), { forms: 0, rules: 0, versions: 2 });
      await assert.rejects(
        applyDesignResourceExtraction(connection, plan, {
          ...options,
          serverUuid: 'other-server',
        }),
        /身份不一致/,
      );
      await connection.query(
        "UPDATE automation_workflow SET description='未发布用户草稿',revision=revision+1 WHERE id=?",
        [fixture.workflowId],
      );
      await assert.rejects(
        previewDesignResourceExtraction(connection),
        /未发布草稿/,
      );
      await assert.rejects(
        applyDesignResourceExtraction(connection, plan, options),
        /未发布草稿/,
      );
      assert.deepEqual(await counts(), { forms: 0, rules: 0, versions: 2 });
      await connection.query(
        "UPDATE automation_workflow SET description='',revision=4 WHERE id=?",
        [fixture.workflowId],
      );
      await connection.query(
        'UPDATE automation_workflow_business_binding SET revision=revision+1',
      );
      await assert.rejects(
        applyDesignResourceExtraction(connection, plan, options),
        /已变化/,
      );
      assert.deepEqual(await counts(), { forms: 0, rules: 0, versions: 2 });
      await connection.query(
        'UPDATE automation_workflow_business_binding SET revision=2',
      );
      const failedConnection = new Proxy(connection, {
        get: (target, property) => {
          if (property === 'query')
            return async (sql, parameters) => {
              if (sql.startsWith('UPDATE automation_workflow_business_binding'))
                throw new Error('fixture injected binding failure');
              return target.query(sql, parameters);
            };
          const value = target[property];
          if (typeof value === 'function') return value.bind(target);
          return value;
        },
      });
      await assert.rejects(
        applyDesignResourceExtraction(failedConnection, plan, options),
        /injected binding failure/,
      );
      assert.deepEqual(await counts(), { forms: 0, rules: 0, versions: 2 });
      const applied = await applyDesignResourceExtraction(
        connection,
        plan,
        options,
      );
      assert.equal(applied.changed, true);
      assert.equal(applied.version, 3);
      assert.deepEqual(await counts(), { forms: 1, rules: 1, versions: 3 });
      const backup = JSON.parse(await readFile(applied.backupPath, 'utf8'));
      assert.equal(backup.snapshot.draft.published_version, 2);
      assert.equal(backup.snapshot.binding.workflow_version, 2);
      const [preservedRuns] = await connection.query(
        'SELECT * FROM automation_workflow_run WHERE id=?',
        [old.runId],
      );
      const [preservedVersions] = await connection.query(
        'SELECT * FROM automation_workflow_revision WHERE version<=2 ORDER BY version',
      );
      assert.deepEqual(preservedRuns, oldRows);
      assert.deepEqual(preservedVersions, oldVersions);
      const repeated = await previewDesignResourceExtraction(connection);
      assert.equal(repeated.status, 'already-extracted');
      assert.deepEqual(
        await applyDesignResourceExtraction(connection, repeated, options),
        {
          changed: false,
          workflowId: fixture.workflowId,
          version: 3,
          backupPath: null,
        },
      );
      assert.deepEqual(await counts(), { forms: 1, rules: 1, versions: 3 });
      const {
        parseWorkflowBpmn,
      } = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
      const {
        advanceWorkflowBpmn,
      } = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
      const sharedModel = await parseWorkflowBpmn(
        await services.definitions.resolve({
          id: fixture.workflowId,
          version: 3,
        }),
      );
      for (const sourceCount of [0, 1, 16]) {
        let result = await advanceWorkflowBpmn(sharedModel, null, {
          input: {
            taskId: services.task.id,
            workId: services.task.workId,
            revision: 7,
            sourceCount,
          },
        });
        const rule = result.jobs[0];
        const output = await services.rules.evaluate(rule.step.ruleRef, {
          sourceCount,
        });
        assert.equal(output.result, sourceCount === 0);
        result = await advanceWorkflowBpmn(
          sharedModel,
          JSON.parse(JSON.stringify(result.checkpoint)),
          {},
          [{ executionId: rule.executionId, output }],
        );
        assert.equal(result.error, null);
        if (sourceCount === 0)
          assert.equal(result.jobs[0].elementId, 'SourceReview');
        else assert.equal(result.jobs[0].elementId, 'Inspect');
      }
      await connection.query('UPDATE automation_form SET revision=2');
      await assert.rejects(
        previewDesignResourceExtraction(connection),
        /公用资源被修改/,
      );
      assert.deepEqual(await counts(), { forms: 1, rules: 1, versions: 3 });
      await connection.query('UPDATE automation_form SET revision=1');
      const current = await seedHumanRun(
        datasource,
        services,
        fixture.workflowId,
        3,
      );
      const [pending] = await services.human.pending(current.runId);
      assert.deepEqual(pending.formRef, plan.resources.form);
      assert.ok(pending.form);
      for (const values of [
        {},
        { confirmed: false },
        { confirmed: true, taskId: 'forged' },
        { confirmed: true, sourceCount: 1 },
        { confirmed: true, revision: 1 },
      ])
        await assert.rejects(
          services.human.submit(
            current.runId,
            current.executionId,
            'fixture-admin',
            values,
          ),
        );
      await assert.rejects(
        services.human.submit(
          current.runId,
          current.executionId,
          'fixture-admin',
          { confirmed: true },
        ),
        /请先补充媒体来源/,
      );
      services.task.sources = [{ descriptorTombstonedAt: null }];
      await services.human.submit(
        current.runId,
        current.executionId,
        'fixture-admin',
        { confirmed: true },
      );
      const [activities] = await connection.query(
        'SELECT step_state FROM automation_workflow_bpmn_activity WHERE run_id=?',
        [current.runId],
      );
      const state = activities[0].step_state;
      assert.deepEqual(state.outputValues, {
        confirmed: true,
        taskId: services.task.id,
        workId: services.task.workId,
        revision: 7,
        sourceCount: 1,
      });
      const oldPending = await services.human.pending(old.runId);
      assert.equal(oldPending[0].formRef, null);
      const formDraft = await services.forms.definitions.detail(
        plan.resources.form.id,
      );
      const changedForm = structuredClone(formDraft.definition);
      changedForm.dataSchema.fields[0].options.push({
        label: '新版本允许未确认',
        value: false,
      });
      await services.forms.definitions.update(formDraft.id, {
        name: formDraft.name,
        description: formDraft.description,
        expectedRevision: formDraft.revision,
        definition: changedForm,
      });
      await services.forms.definitions.publish(formDraft.id, 2, async () => {});
      await assert.rejects(
        services.forms.validate(plan.resources.form, { confirmed: false }),
      );
      assert.deepEqual(
        await services.forms.validate(
          { id: formDraft.id, version: 2 },
          { confirmed: false },
        ),
        { confirmed: false },
      );
      const ruleDraft = await services.rules.definitions.detail(
        plan.resources.rule.id,
      );
      const changedRule = structuredClone(ruleDraft.definition);
      changedRule.condition.value = 1;
      changedRule.testCases = [];
      await services.rules.definitions.update(ruleDraft.id, {
        name: ruleDraft.name,
        description: ruleDraft.description,
        expectedRevision: ruleDraft.revision,
        definition: changedRule,
      });
      await services.rules.definitions.publish(ruleDraft.id, 2, (definition) =>
        services.rules.checkForPublish(definition),
      );
      assert.equal(
        (await services.rules.evaluate(plan.resources.rule, { sourceCount: 0 }))
          .result,
        true,
      );
      assert.equal(
        (
          await services.rules.evaluate(
            { id: ruleDraft.id, version: 2 },
            { sourceCount: 0 },
          )
        ).result,
        false,
      );
    } finally {
      await datasource.destroy();
      await connection.end();
    }
  },
);
