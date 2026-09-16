import { WORKFLOW_DEFINITIONS } from './contract/workflow-provision.port';
import { WorkflowHumanTaskService } from './application/workflow-human-task.service';
import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AutomationPermissionGuard } from '@/common/automation/automation-permission.guard';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { WorkflowDefinitionService } from './application/workflow-definition.service';
import { WorkflowController } from './contract/workflow.controller';
import {
  WorkflowDraft,
  WorkflowRevision,
} from './infrastructure/persistence/workflow.entities';
import {
  WorkflowNodeRun,
  WorkflowNodeVisit,
  WorkflowRun,
} from './infrastructure/persistence/workflow-run.entities';
import { WorkflowExecutionService } from './application/workflow-execution.service';
import { WorkflowExecutionWorker } from './infrastructure/workflow-execution.worker';
import { WORKFLOW_EXECUTION } from './contract/workflow.types';
import { WorkflowRunFeedService } from './application/workflow-run-feed.service';
import { WORKFLOW_RUN_FEED } from './contract/workflow-run-feed.port';
import { WorkflowProcessRegistry } from './application/workflow-process.registry';
import { WorkflowBusinessService } from './application/workflow-business.service';
import {
  WORKFLOW_BUSINESSES,
  WORKFLOW_PROCESSES,
} from './contract/workflow-process.interface';
import { WorkflowBusinessBinding } from './infrastructure/persistence/workflow-business.entity';
import { WorkflowScriptRegistry } from './application/workflow-script.registry';
import { WorkflowScriptExecutionService } from './application/workflow-script-execution.service';
import { WorkflowScriptRunner } from './infrastructure/workflow-script.runner';
import { WorkflowScriptAsset } from './infrastructure/persistence/workflow-script.entity';
import { WorkflowScriptAssetsService } from './application/workflow-script-assets.service';
import { WORKFLOW_SCRIPT_ASSETS } from './contract/workflow-script.types';
import { WorkflowBpmnActivity } from './infrastructure/persistence/workflow-bpmn.entity';
import { WorkflowBpmnExecutionService } from './application/workflow-bpmn-execution.service';

@Module({})
export class WorkflowEngineModule {
  /**
   * 在应用装配处接入提供公开端口的模块，工作流源码不导入其他领域实现。
   * @param imports - 应用根模块选择的规则、表单和原子任务端口提供者。
   * @returns 可独立装配的工作流模块定义。
   */
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: WorkflowEngineModule,
      imports: [
        ConfigModule,
        AdminAuthGuardModule,
        TypeOrmModule.forFeature([
          WorkflowDraft,
          WorkflowRevision,
          WorkflowRun,
          WorkflowNodeRun,
          WorkflowNodeVisit,
          WorkflowBusinessBinding,
          WorkflowScriptAsset,
          WorkflowBpmnActivity,
        ]),
        ...(imports || []),
      ],
      controllers: [WorkflowController],
      providers: [
        WorkflowDefinitionService,
        { provide: WORKFLOW_DEFINITIONS, useExisting: WorkflowDefinitionService },
        WorkflowProcessRegistry,
        WorkflowBusinessService,
        WorkflowScriptRegistry,
        WorkflowScriptExecutionService,
        WorkflowScriptRunner,
        WorkflowScriptAssetsService,
        { provide: WORKFLOW_SCRIPT_ASSETS, useExisting: WorkflowScriptAssetsService },
        { provide: WORKFLOW_PROCESSES, useExisting: WorkflowProcessRegistry },
        { provide: WORKFLOW_BUSINESSES, useExisting: WorkflowBusinessService },
        WorkflowExecutionService,
        WorkflowBpmnExecutionService,
        WorkflowHumanTaskService,
        WorkflowExecutionWorker,
        WorkflowRunFeedService,
        { provide: WORKFLOW_RUN_FEED, useExisting: WorkflowRunFeedService },
        AutomationPermissionGuard,
        { provide: WORKFLOW_EXECUTION, useExisting: WorkflowExecutionService },
      ],
      exports: [
        WORKFLOW_DEFINITIONS,
        WORKFLOW_EXECUTION,
        WORKFLOW_RUN_FEED,
        WORKFLOW_PROCESSES,
        WORKFLOW_BUSINESSES,
        WORKFLOW_SCRIPT_ASSETS,
      ],
    };
  }
}
