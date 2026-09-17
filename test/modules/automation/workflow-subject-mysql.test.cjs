const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const databaseName = process.env.KT_AUTOMATION_TEST_DB;

test(
  '真实 MySQL 事务保持单个活动业务实例、回滚接续和请求幂等',
  {
    skip: !databaseName,
    timeout: 30_000,
  },
  async (t) => {
    assert.match(databaseName, /^kt_template_local_automation_[a-z0-9_]+$/);
    assert.ok(process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID);
    require('ts-node').register({
      project: path.resolve('tsconfig.json'),
      files: true,
    });
    require('tsconfig-paths/register');
    const { DataSource } = require('typeorm');
    const {
      WorkflowRun,
    } = require('../../../src/modules/workflow-engine/infrastructure/persistence/workflow-run.entities');
    const {
      WorkflowDraft,
      WorkflowRevision,
    } = require('../../../src/modules/workflow-engine/infrastructure/persistence/workflow.entities');
    const {
      WorkflowBusinessBinding,
    } = require('../../../src/modules/workflow-engine/infrastructure/persistence/workflow-business.entity');
    const {
      WorkflowDefinitionService,
    } = require('../../../src/modules/workflow-engine/application/workflow-definition.service');
    const {
      WorkflowExecutionService,
    } = require('../../../src/modules/workflow-engine/application/workflow-execution.service');
    const {
      WorkflowBusinessService,
    } = require('../../../src/modules/workflow-engine/application/workflow-business.service');
    const {
      WorkflowProcessRegistry,
    } = require('../../../src/modules/workflow-engine/application/workflow-process.registry');
    const {
      AbstractWorkflowProcess,
    } = require('../../../src/modules/workflow-engine/contract/abstract-workflow-process');
    const processKey = `test.unique-${randomUUID()}`;
    class FixtureProcess extends AbstractWorkflowProcess {
      key = processKey;
      version = 1;
      name = '事务唯一性验收';
      inputSchema = { fields: [] };
      outputSchema = { fields: [] };
      steps = [
        {
          key: 'check',
          name: '核对',
          description: '本地隔离事务验收',
          inputSchema: { fields: [] },
          outputSchema: { fields: [] },
        },
      ];
      prepare = async (context) => ({
        identity: {
          scopeId: context.scopeId,
          subjectId: context.subjectId,
          revision: context.revision,
        },
        input: {},
      });
      prepareStepInput = async () => ({});
      verifyStep = async () => ({});
      verifyResult = async () => {};
    }
    const database = new DataSource({
      type: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: databaseName,
      synchronize: false,
      entities: [
        WorkflowRun,
        WorkflowDraft,
        WorkflowRevision,
        WorkflowBusinessBinding,
      ],
      supportBigNumbers: true,
      bigNumberStrings: true,
      extra: { connectionLimit: 8 },
    });
    await database.initialize();
    let workflowId;
    try {
      const [server] = await database.query('SELECT @@server_uuid uuid');
      assert.equal(server.uuid, process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID);
      const processes = new WorkflowProcessRegistry();
      processes.register(new FixtureProcess());
      const definitions = new WorkflowDefinitionService(
        database,
        undefined,
        undefined,
        undefined,
        processes,
      );
      const definition = {
        format: 'bpmn20',
        model: {
          $type: 'bpmn:Definitions',
          id: 'D',
          targetNamespace: 'urn:kt:test',
          rootElements: [
            {
              $type: 'bpmn:Process',
              id: 'P',
              isExecutable: true,
              extensionElements: {
                $type: 'bpmn:ExtensionElements',
                values: [
                  {
                    $type: 'kt:Contract',
                    body: JSON.stringify({
                      processRef: { key: processKey, version: 1 },
                      inputSchema: { fields: [] },
                      outputSchema: { fields: [] },
                      output: {},
                      formRef: null,
                      formMapping: {},
                      timeoutMs: 60_000,
                    }),
                  },
                ],
              },
              flowElements: [
                { $type: 'bpmn:StartEvent', id: 'Start' },
                { $type: 'bpmn:EndEvent', id: 'End' },
                {
                  $type: 'bpmn:SequenceFlow',
                  id: 'Flow',
                  sourceRef: { $ref: 'Start' },
                  targetRef: { $ref: 'End' },
                },
              ],
            },
          ],
        },
      };
      const publication = await definitions.provision({
        sourceKey: processKey,
        name: '事务唯一性验收',
        definition,
      });
      workflowId = publication.document.id;
      const execution = new WorkflowExecutionService(
        database,
        definitions,
        undefined,
      );
      const business = new WorkflowBusinessService(
        database,
        execution,
        processes,
      );
      const reference = { key: processKey, version: 1 };
      const launch = (subjectId, requestKey, transaction) =>
        business.launch(
          reference,
          {
            scopeId: 'local-test',
            subjectId,
            revision: 1,
            actorId: '7',
            values: {},
            transaction,
          },
          requestKey,
        );
      let committedId;
      for (const scenario of [
        {
          name: '首事务提交后拒绝同对象的另一请求',
          subject: 'commit',
          rollback: false,
          sameKey: false,
        },
        {
          name: '首事务回滚后允许等待中的请求',
          subject: 'rollback',
          rollback: true,
          sameKey: false,
        },
        {
          name: '并发重放返回同一请求原实例',
          subject: 'replay',
          rollback: false,
          sameKey: true,
        },
      ]) {
        await t.test(scenario.name, async () => {
          const first = database.createQueryRunner();
          const second = database.createQueryRunner();
          try {
            await first.startTransaction();
            await second.startTransaction();
            await second.query('SET SESSION innodb_lock_wait_timeout=3');
            const requestKey = `${scenario.subject}-first`;
            const firstRun = await launch(
              scenario.subject,
              requestKey,
              first.manager,
            );
            let nextKey = `${scenario.subject}-second`;
            if (scenario.sameKey) nextKey = requestKey;
            const pending = launch(
              scenario.subject,
              nextKey,
              second.manager,
            ).then(
              (value) => ({ value }),
              (error) => ({ error }),
            );
            const probe = await Promise.race([
              pending,
              new Promise((resolve) =>
                setTimeout(() => resolve('blocked'), 100),
              ),
            ]);
            assert.equal(probe, 'blocked');
            if (scenario.rollback) await first.rollbackTransaction();
            else await first.commitTransaction();
            const outcome = await pending;
            if (outcome.error) await second.rollbackTransaction();
            else await second.commitTransaction();
            if (scenario.sameKey)
              assert.equal(outcome.value?.runId, firstRun.runId);
            else if (scenario.rollback) assert.ok(outcome.value?.runId);
            else {
              assert.equal(outcome.error?.getStatus?.(), 409);
              assert.equal(
                outcome.error?.message,
                '该业务对象已有未结束工作流',
              );
              committedId = firstRun.runId;
            }
            const [count] = await database.query(
              "SELECT COUNT(*) count FROM automation_workflow_run WHERE workflow_id=? AND JSON_UNQUOTE(JSON_EXTRACT(business_context, '$.subjectId'))=?",
              [workflowId, scenario.subject],
            );
            assert.equal(Number(count.count), 1);
          } finally {
            if (first.isTransactionActive) await first.rollbackTransaction();
            if (second.isTransactionActive) await second.rollbackTransaction();
            await first.release();
            await second.release();
          }
        });
      }
      await t.test('终态释放唯一身份并保留历史实例', async () => {
        await database
          .getRepository(WorkflowRun)
          .update(
            { id: committedId },
            { status: 'succeeded', finishedAt: new Date() },
          );
        const next = await launch('commit', 'commit-next');
        assert.notEqual(next.runId, committedId);
        const [count] = await database.query(
          'SELECT COUNT(*) count FROM automation_workflow_run WHERE workflow_id=? AND active_business_subject_key IS NOT NULL',
          [workflowId],
        );
        assert.equal(Number(count.count), 3);
      });
    } finally {
      if (workflowId) {
        await database.getRepository(WorkflowRun).delete({ workflowId });
        await database
          .getRepository(WorkflowBusinessBinding)
          .delete({ processKey });
        await database
          .getRepository(WorkflowRevision)
          .delete({ definitionId: workflowId });
        await database.getRepository(WorkflowDraft).delete({ id: workflowId });
      }
      await database.destroy();
    }
  },
);
