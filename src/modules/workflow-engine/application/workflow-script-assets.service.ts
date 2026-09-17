import {
  BadRequestException,
  ConflictException,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { withDatabaseLock } from '@/common/locks/database-lock';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import {
  normalizeWorkflowScriptSource,
  parseWorkflowScriptUpload,
} from '../domain/workflow-script-upload.policy';
import { WorkflowScriptAsset } from '../infrastructure/persistence/workflow-script.entity';
import { WorkflowScriptRegistry } from './workflow-script.registry';
import { WorkflowProcessRegistry } from './workflow-process.registry';

@Injectable()
export class WorkflowScriptAssetsService implements OnModuleInit {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly scripts: WorkflowScriptRegistry,
    private readonly processes: WorkflowProcessRegistry,
  ) {}

  async onModuleInit() {
    for (const asset of await this.database
      .getRepository(WorkflowScriptAsset)
      .find())
      await this.materialize(asset);
  }

  /**
   * 只解析上传源码的标准声明，返回页面自动展示所需的参数、默认值和结果契约。
   * @param filename - 上传文件名。
   * @param source - 尚未执行的源码内容。
   * @returns 经过校验的业务扩展字段和摘要。
   */
  inspect(filename: unknown, source: unknown) {
    return validateDefinitionInput(() =>
      parseWorkflowScriptUpload(filename, source),
    );
  }

  /**
   * 上传通过标准声明检查的脚本为不可变新版本，不执行代码探测参数或修改旧版本。
   * @param input - 文件名、源码和用户选择的受控执行目标。
   * @returns 持久版本与识别出的扩展参数。
   * @throws 接口步骤不存在、目标非法或同键上传正在提交时拒绝写入。
   */
  async upload(input: { filename: unknown; source: unknown; target: unknown }) {
    const declaration = this.inspect(input.filename, input.source);
    const target = input.target;
    if (target !== 'local' && target !== 'nas')
      throw new BadRequestException('脚本执行目标不支持');
    const compatible = this.processes
      .catalog()
      .some(
        (process) =>
          process.key === declaration.processKey &&
          process.steps.some((step) => step.key === declaration.stepKey),
      );
    if (!compatible)
      throw new BadRequestException('脚本声明的业务接口或步骤尚未装配');
    const lock = `kt:script:${createHash('sha256').update(declaration.key).digest('hex').slice(0, 48)}`;
    const result = await withDatabaseLock(
      this.database,
      lock,
      0,
      async (manager) => {
        const repository = manager.getRepository(WorkflowScriptAsset);
        const existing = await repository.findOneBy({
          key: declaration.key,
          sha256: declaration.sha256,
          target,
        });
        if (existing) {
          await this.materialize(existing);
          return {
            ...existing.declaration,
            version: existing.version,
            target: existing.target,
          };
        }
        const latest = await repository.findOne({
          where: { key: declaration.key },
          order: { version: 'DESC' },
        });
        let version = 1;
        if (latest) version = latest.version + 1;
        const asset = repository.create({
          key: declaration.key,
          version,
          sha256: declaration.sha256,
          target,
          declaration,
          source: normalizeWorkflowScriptSource(
            input.filename as string,
            input.source as string,
          ),
        });
        await repository.insert(asset);
        await this.materialize(asset);
        return { ...declaration, version, target };
      },
    );
    if (!result.acquired)
      throw new ConflictException('同一脚本正在上传，请稍后重试');
    return result.value;
  }

  /**
   * 由数据库源码恢复工作流私有脚本文件并核对内容摘要，只将匹配内容注册到运行时。
   * @param asset - 持久化的不可变脚本版本。
   * @throws 状态目录未配置或文件摘要与版本不符时拒绝装配。
   */
  private async materialize(asset: WorkflowScriptAsset): Promise<void> {
    const root = this.config.get<string>('WORKFLOW_SCRIPT_STATE_ROOT') || '';
    if (!path.isAbsolute(root))
      throw new Error('工作流脚本状态目录需配置绝对路径');
    const directory = path.join(root, 'scripts', asset.sha256);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let filename = 'script.mjs';
    if (asset.declaration.runtime === 'python') filename = 'script.py';
    if (asset.declaration.runtime === 'bash') filename = 'script.sh';
    const scriptPath = path.join(directory, filename);
    try {
      await writeFile(scriptPath, asset.source, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const digest = createHash('sha256')
      .update(await readFile(scriptPath))
      .digest('hex');
    if (digest !== asset.sha256) throw new Error('持久化脚本文件摘要不匹配');
    this.scripts.register({
      ...asset.declaration,
      version: asset.version,
      target: asset.target,
      path: scriptPath,
    });
  }
}
