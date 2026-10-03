const assert = require('node:assert/strict');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { createConnection } = require('mysql2/promise');
const { mediaFixture } = require('./shared-design-fixture.cjs');
const {
  MediaGovernanceWorkflow,
} = require('../../../src/modules/admin/media-governance/application/media-governance.workflow');
const {
  FormDefinitionService,
} = require('../../../src/modules/form-definition/application/form-definition.service');
const {
  RuleEngineService,
} = require('../../../src/modules/rule-engine/application/rule-engine.service');
const {
  WorkflowProcessRegistry,
} = require('../../../src/modules/workflow-engine/application/workflow-process.registry');
const {
  WorkflowScriptRegistry,
} = require('../../../src/modules/workflow-engine/application/workflow-script.registry');
const {
  WorkflowDefinitionService,
} = require('../../../src/modules/workflow-engine/application/workflow-definition.service');
const {
  WorkflowExecutionService,
} = require('../../../src/modules/workflow-engine/application/workflow-execution.service');
const {
  WorkflowBpmnExecutionService,
} = require('../../../src/modules/workflow-engine/application/workflow-bpmn-execution.service');
const {
  WorkflowHumanTaskService,
} = require('../../../src/modules/workflow-engine/application/workflow-human-task.service');
const {
  WorkflowRun,
} = require('../../../src/modules/workflow-engine/infrastructure/persistence/workflow-run.entities');
const {
  WorkflowBpmnActivity,
} = require('../../../src/modules/workflow-engine/infrastructure/persistence/workflow-bpmn.entity');
const {
  createWorkflowActivityState,
} = require('../../../src/modules/workflow-engine/domain/workflow-activity-state');
const {
  advanceWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/infrastructure/workflow-bpmn.runtime');
const {
  parseWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn.policy');
const {
  createSnowflakeId,
} = require('../../../src/common/snowflake/snowflake-id');
const {
  previewDesignResourceExtraction,
  applyDesignResourceExtraction,
} = require('../../../src/commands/automation-design-resources/migration');

/**
 * 只连接调用方明确声明的本机隔离验收库，先验服务器身份后才允许建表。
 * @returns 专用连接及不自动初始化的 TypeORM 数据源配置。
 */
async function openFixtureDatabase() {
  const database = process.env.KT_AUTOMATION_TEST_DB;
  assert.match(database, /^kt_template_local_automation_shared_[a-z0-9_]+$/);
  assert.ok(process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID);
  const options = {
    host: '127.0.0.1',
    port: 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
  const connection = await createConnection(options);
  const [rows] = await connection.query(
    'SELECT DATABASE() name,@@server_uuid uuid',
  );
  assert.equal(rows[0].name, database);
  assert.equal(rows[0].uuid, process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID);
  const entities = [
    'workflow.entities',
    'workflow-run.entities',
    'workflow-business.entity',
    'workflow-bpmn.entity',
    'workflow-script.entity',
  ].flatMap((name) =>
    Object.values(
      require(
        `../../../src/modules/workflow-engine/infrastructure/persistence/${name}`,
      ),
    ),
  );
  entities.push(
    ...Object.values(
      require('../../../src/modules/form-definition/infrastructure/persistence/form.entities'),
    ),
    ...Object.values(
      require('../../../src/modules/rule-engine/infrastructure/persistence/rule.entities'),
    ),
  );
  const datasource = new DataSource({
    type: 'mysql',
    host: options.host,
    port: options.port,
    username: options.user,
    password: options.password,
    database,
    supportBigNumbers: true,
    bigNumberStrings: true,
    entities,
    synchronize: false,
  });
  await datasource.initialize();
  await datasource.synchronize();
  return { connection, datasource };
}

/**
 * 清空本任务明确授权的隔离 fixture 表，创建可重复验证的旧版本和绑定。
 * @param connection - 已核对本机隔离库身份的连接。
 * @returns 脱敏图、脚本和旧工作流身份。
 */
async function seedOriginal(connection) {
  for (const table of [
    'automation_workflow_bpmn_activity',
    'automation_workflow_run',
    'automation_workflow_business_binding',
    'automation_workflow_revision',
    'automation_workflow',
    'automation_form_revision',
    'automation_form',
    'automation_ruleset_revision',
    'automation_ruleset',
    'automation_workflow_script',
  ])
    await connection.query(`DELETE FROM ${table}`);
  const fixture = mediaFixture();
  const workflowId = createSnowflakeId();
  await connection.query(
    "INSERT INTO automation_workflow (id,name,description,revision,published_version,definition) VALUES (?,'媒体治理验收','',4,2,?)",
    [workflowId, JSON.stringify(fixture.definition)],
  );
  for (const version of [1, 2])
    await connection.query(
      "INSERT INTO automation_workflow_revision (definition_id,version,name,description,definition) VALUES (?,?,'媒体治理验收','',?)",
      [workflowId, version, JSON.stringify(fixture.definition)],
    );
  await connection.query(
    "INSERT INTO automation_workflow_business_binding (process_key,scope_id,process_version,workflow_id,workflow_version,revision) VALUES ('media.governance','business',1,?,2,2)",
    [workflowId],
  );
  for (const script of fixture.scripts)
    await connection.query(
      'INSERT INTO automation_workflow_script (script_key,version,sha256,target,declaration,source_text) VALUES (?,?,?,?,?,?)',
      [
        script.key,
        script.version,
        script.sha256,
        script.target,
        JSON.stringify(script.declaration),
        script.source,
      ],
    );
  return { ...fixture, workflowId };
}

/**
 * 装配真实规则、表单、人工服务和工作流读取服务，媒体存储仅由隔离对象提供。
 * @param datasource - 隔离库的 TypeORM 数据源。
 * @param fixture - 脱敏固定脚本与媒体图。
 * @returns 真实服务实例和用于改变权威来源状态的本地对象。
 */
function fixtureServices(datasource, fixture) {
  const task = {
    id: 'fixture-task',
    workId: 'fixture-work',
    revision: 7,
    activeRunId: null,
    sources: [],
  };
  const process = new MediaGovernanceWorkflow({
    workflowTask: async (_scope, subject) => {
      assert.equal(subject, task.id);
      return task;
    },
  });
  const processes = new WorkflowProcessRegistry();
  processes.register(process);
  const scripts = new WorkflowScriptRegistry();
  for (const script of fixture.scripts)
    scripts.register({
      ...script.declaration,
      key: script.key,
      version: script.version,
      sha256: script.sha256,
      target: script.target,
      path: path.resolve('test/modules/automation/fixture-not-executed.mjs'),
    });
  const forms = new FormDefinitionService(datasource),
    rules = new RuleEngineService(datasource);
  const definitions = new WorkflowDefinitionService(
    datasource,
    rules,
    forms,
    undefined,
    processes,
    scripts,
  );
  const human = new WorkflowHumanTaskService(datasource, forms, processes);
  const bpmn = new WorkflowBpmnExecutionService(processes, rules);
  const execution = new WorkflowExecutionService(
    datasource,
    definitions,
    forms,
    bpmn,
    human,
  );
  return {
    task,
    forms,
    rules,
    definitions,
    human,
    execution,
    processes,
    scripts,
  };
}

/**
 * 用真实 BPMN 引擎和公用规则求值建立零来源的人工等待实例，无媒体脚本副作用。
 * @param datasource - 当前隔离数据源。
 * @param services - 已装配的真实规则、流程服务。
 * @param workflowId - 验收工作流身份。
 * @param version - 要固定引用的旧版或抽离版本。
 * @returns 已保存实例和其准确人工活动身份。
 */
async function seedHumanRun(datasource, services, workflowId, version) {
  const definition = await services.definitions.resolve({
    id: workflowId,
    version,
  });
  const input = {
    taskId: services.task.id,
    workId: services.task.workId,
    revision: services.task.revision,
    sourceCount: 0,
  };
  const model = await parseWorkflowBpmn(definition);
  let result = await advanceWorkflowBpmn(model, null, { input });
  if (result.jobs[0].step.kind === 'rule') {
    const output = await services.rules.evaluate(result.jobs[0].step.ruleRef, {
      sourceCount: 0,
    });
    result = await advanceWorkflowBpmn(
      model,
      JSON.parse(JSON.stringify(result.checkpoint)),
      {},
      [{ executionId: result.jobs[0].executionId, output }],
    );
  }
  assert.equal(result.error, null);
  assert.equal(result.jobs[0].step.kind, 'human');
  const runId = createSnowflakeId(),
    job = result.jobs[0];
  const run = {
    id: runId,
    workflowId,
    workflowVersion: version,
    executionKey: `fixture-${runId}`,
    requestHash: '0'.repeat(64),
    businessContext: {
      processRef: { key: 'media.governance', version: 1 },
      scopeId: 'fixture',
      subjectId: services.task.id,
      revision: services.task.revision,
      actorId: 'fixture-admin',
    },
    businessSubjectKey: null,
    status: 'running',
    inputValues: input,
    formValues: null,
    outputValues: null,
    bpmnState: {
      checkpoint: result.checkpoint,
      status: 'waiting',
      error: null,
      nextWakeAt: null,
      outputs: result.checkpoint.outputs,
      transitions: result.transitions,
    },
    cancelRequested: false,
    errorMessage: null,
    deadlineAt: new Date(Date.now() + 3600000),
    nextWakeAt: new Date(),
    finishedAt: null,
  };
  await datasource.getRepository(WorkflowRun).insert(run);
  const state = createWorkflowActivityState(1);
  state.status = 'waiting';
  state.preparedInput = {};
  await datasource
    .getRepository(WorkflowBpmnActivity)
    .insert({
      runId,
      executionId: job.executionId,
      elementId: job.elementId,
      job,
      state,
      delivered: false,
      cancelRequested: false,
    });
  return { runId, executionId: job.executionId };
}

/**
 * 在本机隔离库执行与生产相同的预演、事务应用，用于 HTTP fixture 初始化。
 * @param connection - 明确身份的本地连接。
 * @param backupDirectory - 本任务临时证据目录。
 * @returns 冻结预演计划和事务应用结果。
 */
async function extractFixture(connection, backupDirectory) {
  const plan = await previewDesignResourceExtraction(connection);
  const result = await applyDesignResourceExtraction(connection, plan, {
    databaseName: process.env.KT_AUTOMATION_TEST_DB,
    serverUuid: process.env.KT_AUTOMATION_TEST_DB_SERVER_UUID,
    backupDirectory,
  });
  return { plan, result };
}

module.exports = {
  openFixtureDatabase,
  seedOriginal,
  fixtureServices,
  seedHumanRun,
  extractFixture,
};
