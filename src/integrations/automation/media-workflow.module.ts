import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MEDIA_WORKFLOW,
  type MediaWorkflowPort,
} from '@/modules/admin/media-governance/contract/media-workflow.port';
import {
  WORKFLOW_BUSINESSES,
  WORKFLOW_PROCESSES,
  type WorkflowBusinessPort,
  type WorkflowProcessRegistryPort,
} from '@/modules/workflow-engine/contract/workflow-process.interface';
import {
  WORKFLOW_EXECUTION,
  type WorkflowExecutionPort,
} from '@/modules/workflow-engine/contract/workflow.types';
import {
  WORKFLOW_SCRIPT_ASSETS,
  type WorkflowScriptAssetsPort,
} from '@/modules/workflow-engine/contract/workflow-script.types';

@Injectable()
class MediaWorkflowRegistration implements OnModuleInit, OnModuleDestroy {
  private readonly releases: Array<() => void> = [];
  constructor(
    @Inject(MEDIA_WORKFLOW) private readonly media: MediaWorkflowPort,
    @Inject(WORKFLOW_PROCESSES)
    private readonly processes: WorkflowProcessRegistryPort,
    @Inject(WORKFLOW_BUSINESSES)
    private readonly businesses: WorkflowBusinessPort,
    @Inject(WORKFLOW_EXECUTION)
    private readonly execution: WorkflowExecutionPort,
    @Inject(WORKFLOW_SCRIPT_ASSETS)
    private readonly assets: WorkflowScriptAssetsPort,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    for (const process of this.media.processes) this.releases.push(this.processes.register(process));
    this.releases.push(this.media.connect(this.businesses, this.execution));
    await this.provisionScripts();
  }

  onModuleDestroy() {
    for (const release of this.releases.splice(0).reverse()) release();
  }

  /**
   * 将明确配置的媒体发布摘要固化到标准脚本源码，交工作流资产端口保存不可变版本。
   * @throws 只配置部分摘要或发布摘要格式不合法时拒绝装配内置脚本。
   */
  private async provisionScripts(): Promise<void> {
    const pins = [
      'WORKFLOW_MEDIA_RELEASE_SHA256',
      'WORKFLOW_MEDIA_MANIFEST_SHA256',
      'WORKFLOW_MEDIA_CONFIG_SHA256',
    ].map((key) => String(this.config.get(key) ?? '').trim());
    if (pins.every((value) => !value)) return;
    if (pins.some((value) => !/^[a-f0-9]{64}$/.test(value)))
      throw new Error('媒体一次性脚本必须同时固定发布、文件清单及配置摘要');
    let source = await readFile(
      resolve('scripts/workflow/media-action.mjs'),
      'utf8',
    );
    for (const [index, placeholder] of [
      'RELEASE',
      'MANIFEST',
      'CONFIG',
    ].entries())
      source = source.replace(
        `__KT_MEDIA_${placeholder}_SHA256__`,
        pins[index],
      );
    const identityFields = [
      {
        key: 'mediaRunId',
        label: '媒体步骤运行',
        type: 'string',
        required: true,
      },
      { key: 'taskId', label: '媒体任务', type: 'string', required: true },
      {
        key: 'sealedInputSha256',
        label: '密封输入摘要',
        type: 'string',
        required: true,
      },
    ];
    for (const { process, step } of this.media.processes.flatMap((process) => process.steps.map((step) => ({ process, step })))) {
      const declaration = {
        protocol: 'kt.workflow.script.v1',
        key: `${process.key}.${step.key}`,
        name: step.name,
        description: '',
        processKey: process.key,
        stepKey: step.key,
        maxTimeoutMs: 86400000,
        idempotent: false,
        paramsSchema: { fields: identityFields },
        resultSchema: {
          fields: [
            ...identityFields,
            {
              key: 'evidenceSha256',
              label: '媒体证据摘要',
              type: 'string',
              required: true,
            },
          ],
        },
        defaults: {},
      };
      await this.assets.upload({
        filename: `${step.key}.mjs`,
        target: 'nas',
        source: `/* @kt-workflow-script\n${JSON.stringify(declaration, null, 2)}\n@end-kt-workflow-script */\n${source}`,
      });
    }
  }
}

@Module({})
export class MediaWorkflowModule {
  /**
   * 在组合层连接媒体实现与工作流公开端口，两个领域模块不相互导入实现类。
   * @param imports - 同一应用实例的媒体模块和工作流动态模块。
   * @returns 只注册业务能力与端口连接的集成模块。
   */
  static register(imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: MediaWorkflowModule,
      imports: [ConfigModule, ...(imports ?? [])],
      providers: [MediaWorkflowRegistration],
    };
  }
}
