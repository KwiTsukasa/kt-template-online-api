const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { Test } = require('@nestjs/testing');
const {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
} = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { vbenSuccess } = require('../../../src/common');
const {
  JwtAuthGuard,
} = require('../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard');
const {
  AutomationPermissionGuard,
} = require('../../../src/common/automation/automation-permission.guard');
const {
  FormController,
} = require('../../../src/modules/form-definition/contract/form.controller');
const {
  RuleController,
} = require('../../../src/modules/rule-engine/contract/rule.controller');
const {
  WorkflowController,
} = require('../../../src/modules/workflow-engine/contract/workflow.controller');
const {
  FormDefinitionService,
} = require('../../../src/modules/form-definition/application/form-definition.service');
const {
  RuleEngineService,
} = require('../../../src/modules/rule-engine/application/rule-engine.service');
const {
  WorkflowDefinitionService,
} = require('../../../src/modules/workflow-engine/application/workflow-definition.service');
const {
  WorkflowExecutionService,
} = require('../../../src/modules/workflow-engine/application/workflow-execution.service');
const {
  WorkflowProcessRegistry,
} = require('../../../src/modules/workflow-engine/application/workflow-process.registry');
const {
  WorkflowScriptRegistry,
} = require('../../../src/modules/workflow-engine/application/workflow-script.registry');
const {
  WorkflowScriptAssetsService,
} = require('../../../src/modules/workflow-engine/application/workflow-script-assets.service');
const {
  openFixtureDatabase,
  seedOriginal,
  fixtureServices,
  seedHumanRun,
  extractFixture,
} = require('./shared-design-mysql-fixture.cjs');
let activeServices, activeRun;

class LocalHumanController {
  /**
   * 读取此隔离实例真实人工服务生成的固定版本表单。
   * @returns 当前人工待办及其可写字段。
   */
  async pending() {
    return vbenSuccess(await activeServices.human.pending(activeRun.runId));
  }
  /**
   * 把本机 fixture 输入交给真实人工服务，操作者与实例均由隔离服务固定。
   * @param body - 当前活动身份和用户填写值。
   * @returns 当前实例的真实持久状态。
   */
  async complete(body) {
    assert.equal(body.runId, activeRun.runId);
    assert.equal(body.executionId, activeRun.executionId);
    await activeServices.human.submit(
      activeRun.runId,
      activeRun.executionId,
      'fixture-admin',
      body.values,
    );
    return vbenSuccess(await activeServices.execution.read(activeRun.runId));
  }
  /**
   * 在隔离存储对象中补齐来源，验证权威回调与表单提交的边界。
   * @returns 本地对象当前来源数量。
   */
  sourceReady() {
    activeServices.task.sources = [{ descriptorTombstonedAt: null }];
    return vbenSuccess({ sourceCount: 1 });
  }
}
Controller('media-governance/tasks/fixture-task/workflow')(
  LocalHumanController,
);
Get('human-tasks')(
  LocalHumanController.prototype,
  'pending',
  Object.getOwnPropertyDescriptor(LocalHumanController.prototype, 'pending'),
);
Post('human-tasks/complete')(
  LocalHumanController.prototype,
  'complete',
  Object.getOwnPropertyDescriptor(LocalHumanController.prototype, 'complete'),
);
HttpCode(200)(
  LocalHumanController.prototype,
  'complete',
  Object.getOwnPropertyDescriptor(LocalHumanController.prototype, 'complete'),
);
Body()(LocalHumanController.prototype, 'complete', 0);
Post('fixture/source-ready')(
  LocalHumanController.prototype,
  'sourceReady',
  Object.getOwnPropertyDescriptor(
    LocalHumanController.prototype,
    'sourceReady',
  ),
);
HttpCode(200)(
  LocalHumanController.prototype,
  'sourceReady',
  Object.getOwnPropertyDescriptor(
    LocalHumanController.prototype,
    'sourceReady',
  ),
);

/**
 * 启动仅绑定回环的真实 Nest 设计资源 fixture，供现有 Admin 和定向 HTTP 验证共用。
 * @param options - 明确的任务证据根和端口，可选择保留至主代理完成浏览器验证。
 * @returns 可清理的应用、连接、运行身份及预演计划。
 */
async function startSharedDesignFixture(options) {
  assert.ok(
    path.isAbsolute(options.artifactRoot) &&
      options.artifactRoot.includes('.kt-workspace'),
  );
  assert.equal(options.port, 48086);
  const { connection, datasource } = await openFixtureDatabase();
  let app;
  try {
    const fixture = await seedOriginal(connection);
    const { plan, result } = await extractFixture(
      connection,
      path.join(options.artifactRoot, 'http-backups'),
    );
    const services = fixtureServices(datasource, fixture);
    const scriptsDirectory = path.join(
      options.artifactRoot,
      'http-script-assets',
    );
    const assetScripts = new WorkflowScriptRegistry();
    const assets = new WorkflowScriptAssetsService(
      datasource,
      new ConfigService({ WORKFLOW_SCRIPT_STATE_ROOT: scriptsDirectory }),
      assetScripts,
      services.processes,
    );
    const waiting = await seedHumanRun(
      datasource,
      services,
      fixture.workflowId,
      result.version,
    );
    activeServices = services;
    activeRun = waiting;
    const providers = [
      [FormDefinitionService, services.forms],
      [RuleEngineService, services.rules],
      [WorkflowDefinitionService, services.definitions],
      [WorkflowExecutionService, services.execution],
      [WorkflowProcessRegistry, services.processes],
      [WorkflowScriptRegistry, assetScripts],
      [WorkflowScriptAssetsService, assets],
    ].map(([provide, useValue]) => ({ provide, useValue }));
    const module = await Test.createTestingModule({
      controllers: [
        FormController,
        RuleController,
        WorkflowController,
        LocalHumanController,
      ],
      providers: [AutomationPermissionGuard, ...providers],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          const request = context.switchToHttp().getRequest();
          request.adminUser = {
            id: 'fixture-admin',
            roles: [{ roleCode: 'super', status: 1, isDeleted: false }],
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(options.port, '127.0.0.1');
    const identity = {
      base: `http://127.0.0.1:${options.port}/api`,
      taskId: services.task.id,
      workflowId: fixture.workflowId,
      workflowVersion: result.version,
      runId: waiting.runId,
      executionId: waiting.executionId,
      resources: plan.resources,
      fixtureAuth: '仅本机fixture守卫，未验证真实鉴权',
      mediaStorage: '仅隔离对象存储，权威确认调用真实MediaGovernanceWorkflow',
    };
    await mkdir(options.artifactRoot, { recursive: true });
    await writeFile(
      path.join(options.artifactRoot, 'http-fixture-identity.json'),
      JSON.stringify(identity, null, 2),
    );
    return {
      app,
      datasource,
      connection,
      services,
      plan,
      identity,
      close: async () => {
        await app.close();
        await datasource.destroy();
        await connection.end();
      },
    };
  } catch (error) {
    if (app) await app.close();
    await datasource.destroy();
    await connection.end();
    throw error;
  }
}

module.exports = { startSharedDesignFixture };
if (require.main === module) {
  void startSharedDesignFixture({
    artifactRoot: process.env.WORKFLOW_RUNTIME_TEST_ROOT,
    port: 48086,
  })
    .then((fixture) => {
      process.stdout.write(JSON.stringify(fixture.identity) + '\n');
      const stop = async () => {
        await fixture.close();
        process.exit(0);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    })
    .catch((error) => {
      process.stderr.write(String(error.message) + '\n');
      process.exitCode = 1;
    });
}
