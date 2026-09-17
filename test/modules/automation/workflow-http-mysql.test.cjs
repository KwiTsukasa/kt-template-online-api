const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdir, readFile } = require('node:fs/promises');
const path = require('node:path');

test(
  '真实 HTTP、发布绑定、MySQL 检查点和按序短脚本贯通',
  { skip: !process.env.KT_AUTOMATION_TEST_DB, timeout: 150_000 },
  async () => {
    const databaseName = process.env.KT_AUTOMATION_TEST_DB;
    assert.match(databaseName, /^kt_template_local_automation_[a-z0-9_]+$/);
    const artifactRoot = process.env.WORKFLOW_RUNTIME_TEST_ROOT;
    assert.ok(
      artifactRoot &&
        path.isAbsolute(artifactRoot) &&
        artifactRoot.includes('.kt-workspace'),
    );
    const artifact = path.join(artifactRoot, `http-${randomUUID()}`);
    assert.ok(process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID);
    require('ts-node').register({
      project: path.resolve('tsconfig.json'),
      files: true,
    });
    require('tsconfig-paths/register');
    const { Test } = require('@nestjs/testing');
    const { ConfigService } = require('@nestjs/config');
    const { DataSource } = require('typeorm');
    const {
      JwtAuthGuard,
    } = require('../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard');
    const {
      AutomationPermissionGuard,
    } = require('../../../src/common/automation/automation-permission.guard');
    const load = (name) =>
      require(`../../../src/modules/workflow-engine/${name}`);
    const { WorkflowController } = load('contract/workflow.controller');
    const { WorkflowDefinitionService } = load(
      'application/workflow-definition.service',
    );
    const { WorkflowExecutionService } = load(
      'application/workflow-execution.service',
    );
    const { WorkflowBpmnExecutionService } = load(
      'application/workflow-bpmn-execution.service',
    );
    const { WorkflowBusinessService } = load(
      'application/workflow-business.service',
    );
    const { WorkflowProcessRegistry } = load(
      'application/workflow-process.registry',
    );
    const { WorkflowScriptRegistry } = load(
      'application/workflow-script.registry',
    );
    const { WorkflowScriptAssetsService } = load(
      'application/workflow-script-assets.service',
    );
    const { WorkflowScriptExecutionService } = load(
      'application/workflow-script-execution.service',
    );
    const { WorkflowScriptRunner } = load(
      'infrastructure/workflow-script.runner',
    );
    const { WorkflowNasTransport } = load(
      'infrastructure/workflow-nas.transport',
    );
    const { AbstractWorkflowProcess } = load(
      'contract/abstract-workflow-process',
    );
    const {
      FormDefinitionService,
    } = require('../../../src/modules/form-definition/application/form-definition.service');
    const {
      RuleEngineService,
    } = require('../../../src/modules/rule-engine/application/rule-engine.service');
    const { WORKFLOW_SCRIPT_PROTOCOL } = load('constants/script');
    const { KT_BPMN_STEP } = load('constants/bpmn');
    const entities = [
      'workflow.entities',
      'workflow-run.entities',
      'workflow-business.entity',
      'workflow-bpmn.entity',
      'workflow-script.entity',
    ].flatMap((name) =>
      Object.values(load(`infrastructure/persistence/${name}`)),
    );
    entities.push(
      ...Object.values(
        require('../../../src/modules/form-definition/infrastructure/persistence/form.entities'),
      ),
      ...Object.values(
        require('../../../src/modules/rule-engine/infrastructure/persistence/rule.entities'),
      ),
    );
    const database = new DataSource({
      type: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: databaseName,
      synchronize: false,
      entities,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await database.initialize();
    const { WorkflowRun } = load(
      'infrastructure/persistence/workflow-run.entities',
    );
    const { WorkflowDraft, WorkflowRevision } = load(
      'infrastructure/persistence/workflow.entities',
    );
    const { WorkflowBpmnActivity } = load(
      'infrastructure/persistence/workflow-bpmn.entity',
    );
    const { WorkflowBusinessBinding } = load(
      'infrastructure/persistence/workflow-business.entity',
    );
    const { WorkflowScriptAsset } = load(
      'infrastructure/persistence/workflow-script.entity',
    );
    const processKey = `test.http-${randomUUID()}`;
    const elementId = 'n'.repeat(191);
    const inputSchema = {
      fields: [
        { key: 'amount', label: '数量', type: 'number', required: true },
      ],
    };
    const outputSchema = {
      fields: [{ key: 'value', label: '结果', type: 'number', required: true }],
    };
    const completions = [];
    class FixtureProcess extends AbstractWorkflowProcess {
      key = processKey;
      version = 1;
      name = 'HTTP 隔离业务';
      inputSchema = inputSchema;
      outputSchema = outputSchema;
      steps = [
        {
          key: 'calculate',
          name: '计算',
          description: '验收脚本顺序及结果',
          inputSchema,
          outputSchema,
        },
      ];
      prepare = async (context) => ({
        identity: {
          scopeId: context.scopeId,
          subjectId: context.subjectId,
          revision: context.revision,
        },
        input: context.values,
      });
      prepareStepInput = async (invocation) => ({
        amount: invocation.input.amount,
      });
      verifyStep = async ({ results }) => {
        assert.deepEqual(
          results.map((result) => result.output.value),
          [4, 6],
        );
        return results[1].output;
      };
      verifyResult = async (context) => {
        completions.push(context.output);
      };
    }
    let app, workflowId, runId;
    const scriptKeys = [];
    try {
      const [identity] = await database.query('SELECT @@server_uuid uuid');
      assert.equal(
        identity.uuid,
        process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID,
      );
      await mkdir(artifact, { recursive: true });
      const processes = new WorkflowProcessRegistry();
      processes.register(new FixtureProcess());
      const scripts = new WorkflowScriptRegistry();
      const config = new ConfigService({
        WORKFLOW_SCRIPT_STATE_ROOT: artifact,
      });
      const assets = new WorkflowScriptAssetsService(
        database,
        config,
        scripts,
        processes,
      );
      const forms = new FormDefinitionService(database),
        rules = new RuleEngineService(database);
      const definitions = new WorkflowDefinitionService(
        database,
        rules,
        forms,
        undefined,
        processes,
        scripts,
      );
      const runner = new WorkflowScriptRunner(
        config,
        new WorkflowNasTransport(config),
      );
      const scriptExecution = new WorkflowScriptExecutionService(
        scripts,
        runner,
      );
      const bpmn = new WorkflowBpmnExecutionService(
        processes,
        rules,
        scriptExecution,
      );
      const execution = new WorkflowExecutionService(
        database,
        definitions,
        forms,
        bpmn,
      );
      const business = new WorkflowBusinessService(
        database,
        execution,
        processes,
      );
      const providers = [
        [WorkflowDefinitionService, definitions],
        [WorkflowExecutionService, execution],
        [WorkflowProcessRegistry, processes],
        [WorkflowScriptRegistry, scripts],
        [WorkflowScriptAssetsService, assets],
      ].map(([provide, useValue]) => ({ provide, useValue }));
      const module = await Test.createTestingModule({
        controllers: [WorkflowController],
        providers: [AutomationPermissionGuard, ...providers],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context) => {
            const request = context.switchToHttp().getRequest();
            request.adminUser = { roles: [] };
            if (request.headers['x-local-fixture'] === 'authorized')
              request.adminUser.roles = [
                { roleCode: 'super', status: 1, isDeleted: false },
              ];
            return true;
          },
        })
        .compile();
      app = module.createNestApplication({ logger: false });
      await app.listen(29597, '127.0.0.1');
      const base = 'http://127.0.0.1:29597/automation/workflows';
      const request = async (
        route,
        body,
        expected = 200,
        authorized = true,
      ) => {
        const response = await fetch(base + route, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-local-fixture': authorized ? 'authorized' : 'forbidden',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        const value = await response.json();
        assert.equal(response.status, expected, JSON.stringify(value));
        return value.data;
      };
      await request('/processes', undefined, 403, false);
      await request(
        '/scripts/inspect',
        { filename: 'bad.mjs', source: 'console.log(1)' },
        400,
      );
      const calls = [];
      const marker = path.join(artifact, 'script-order.txt');
      for (let index = 0; index < 2; index++) {
        const key = `test.script-${randomUUID()}`;
        scriptKeys.push(key);
        const metadata = {
          protocol: WORKFLOW_SCRIPT_PROTOCOL,
          key,
          name: `计算 ${index + 1}`,
          description: '',
          processKey,
          stepKey: 'calculate',
          maxTimeoutMs: 5000,
          idempotent: true,
          paramsSchema: inputSchema,
          resultSchema: outputSchema,
          defaults: {},
        };
        const source = `/* @kt-workflow-script\n${JSON.stringify(metadata)}\n@end-kt-workflow-script */\nimport { appendFileSync, readFileSync } from 'node:fs'; let text=''; for await (const chunk of process.stdin) text+=chunk; const input=JSON.parse(text); const marker=${JSON.stringify(marker)}; if (${index}===1 && readFileSync(marker,'utf8')!=='0\\n') throw new Error('out of order'); appendFileSync(marker,'${index}\\n'); console.log(JSON.stringify({ protocol:input.protocol, kind:'result', executionId:input.executionId, scriptSha256:input.scriptSha256, sequence:1, status:'succeeded', data:{value:input.params.amount*${index + 2}}, error:null }));`;
        const asset = await request('/scripts', {
          filename: `calculate-${index}.mjs`,
          source,
          target: 'local',
        });
        assert.deepEqual(asset.paramsSchema, inputSchema);
        calls.push({
          key: asset.key,
          version: asset.version,
          sha256: asset.sha256,
          timeoutMs: 5000,
          maxAttempts: 1,
          retryBackoffMs: 1000,
          params: {},
        });
      }
      const ref = (id) => ({ $ref: id });
      const definition = {
        format: 'bpmn20',
        model: {
          $type: 'bpmn:Definitions',
          id: 'definition',
          targetNamespace: 'urn:kt:http-integration',
          rootElements: [
            {
              $type: 'bpmn:Process',
              id: 'process',
              isExecutable: true,
              extensionElements: {
                $type: 'bpmn:ExtensionElements',
                values: [
                  {
                    $type: 'kt:Contract',
                    body: JSON.stringify({
                      processRef: { key: processKey, version: 1 },
                      inputSchema,
                      outputSchema,
                      output: {
                        value: {
                          type: 'node',
                          nodeId: elementId,
                          field: 'value',
                        },
                      },
                      formRef: null,
                      formMapping: {},
                      timeoutMs: 180_000,
                    }),
                  },
                ],
              },
              flowElements: [
                { $type: 'bpmn:StartEvent', id: 'start' },
                {
                  $type: 'bpmn:ServiceTask',
                  id: elementId,
                  implementation: KT_BPMN_STEP,
                  extensionElements: {
                    $type: 'bpmn:ExtensionElements',
                    values: [
                      {
                        $type: 'kt:Step',
                        body: JSON.stringify({
                          kind: 'business',
                          stepKey: 'calculate',
                          input: { amount: { type: 'input', field: 'amount' } },
                          scripts: calls,
                        }),
                      },
                    ],
                  },
                },
                { $type: 'bpmn:EndEvent', id: 'end' },
                {
                  $type: 'bpmn:SequenceFlow',
                  id: 'first',
                  sourceRef: ref('start'),
                  targetRef: ref(elementId),
                },
                {
                  $type: 'bpmn:SequenceFlow',
                  id: 'last',
                  sourceRef: ref(elementId),
                  targetRef: ref('end'),
                },
              ],
            },
          ],
        },
      };
      assert.equal((await request('/validate', { definition })).valid, true);
      const draft = await request('', { name: processKey, definition });
      workflowId = draft.id;
      const published = await request(`/${workflowId}/publish`, {
        expectedRevision: draft.revision,
      });
      assert.equal(
        (await business.binding({ key: processKey, version: 1 })).workflowRef
          .version,
        1,
      );
      const context = {
        scopeId: 'fixture',
        subjectId: 'subject',
        revision: 1,
        actorId: 'fixture',
        values: { amount: 2 },
      };
      ({ runId } = await business.launch(
        { key: processKey, version: 1 },
        context,
        'same-request',
      ));
      assert.deepEqual(
        await business.launch(
          { key: processKey, version: 1 },
          context,
          'same-request',
        ),
        { runId },
      );
      const nextDraft = await request(`/${workflowId}/draft`, {
        name: processKey,
        definition,
        expectedRevision: published.revision,
      });
      await request(`/${workflowId}/publish`, {
        expectedRevision: nextDraft.revision,
      });
      assert.equal(
        (await business.binding({ key: processKey, version: 1 })).workflowRef
          .version,
        2,
      );
      let run;
      const deadline = Date.now() + 100_000;
      do {
        await execution.process(runId);
        run = await request(`/runs/${runId}`);
        if (['succeeded', 'failed', 'cancelled'].includes(run.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      assert.equal(run.status, 'succeeded', JSON.stringify(run));
      assert.equal(run.workflowVersion, 1);
      assert.ok(run.activities[0].executionId.length > 191);
      assert.deepEqual(run.output, { value: 6 });
      const visits = await request(`/runs/${runId}/nodes/${elementId}/visits`);
      assert.equal(visits.items.length, 1);
      assert.deepEqual(visits.items[0].output, { value: 6 });
      assert.deepEqual(
        (
          await request(
            `/runs/${runId}/nodes/${elementId}/visits?beforeVisit=1`,
          )
        ).items,
        [],
      );
      await request(
        `/runs/${runId}/nodes/${elementId}/visits?beforeVisit=invalid`,
        undefined,
        400,
      );
      assert.deepEqual(completions, [{ value: 6 }]);
      await execution.process(runId);
      assert.equal(await readFile(marker, 'utf8'), '0\n1\n');
      const persisted = await database
        .getRepository(WorkflowRun)
        .findOneByOrFail({ id: runId });
      assert.ok(persisted.bpmnState.checkpoint.engine);
      assert.equal(
        (await request(`/${workflowId}/versions/1`)).format,
        'bpmn20',
      );
      const exported = await fetch(base + '/export', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-local-fixture': 'authorized',
        },
        body: JSON.stringify({ definition }),
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get('content-type'), /application\/xml/);
      assert.match(await exported.text(), /definitions/);
    } finally {
      if (app) await app.close();
      if (runId) {
        await database.getRepository(WorkflowBpmnActivity).delete({ runId });
      }
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
      for (const key of scriptKeys)
        await database.getRepository(WorkflowScriptAsset).delete({ key });
      await database.destroy();
    }
  },
);
