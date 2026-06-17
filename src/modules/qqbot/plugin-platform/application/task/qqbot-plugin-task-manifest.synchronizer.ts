import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QqbotPluginTaskManifest } from '../../domain/manifest';
import { QqbotPluginTask } from '../../infrastructure/persistence';

export type SyncPluginManifestTasksInput = {
  installationId: string;
  manifestTasks: QqbotPluginTaskManifest[];
  pluginId: string;
};

@Injectable()
export class QqbotPluginTaskManifestSynchronizer {
  /**
   * 初始化 QqbotPluginTaskManifestSynchronizer 实例。
   * @param taskRepository - 插件任务仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
  ) {}

  /**
   * 更新 QQBot 插件平台状态。
   * @param input - input 输入；使用 `manifestTasks`、`installationId`、`pluginId` 字段生成结果。
   */
  async syncManifestTasks(input: SyncPluginManifestTasksInput) {
    const tasks: QqbotPluginTask[] = [];
    for (const manifestTask of input.manifestTasks) {
      const existing = await this.taskRepository.findOne({
        where: {
          installationId: input.installationId,
          taskKey: manifestTask.key,
        },
      });
      const task = this.taskRepository.create({
        ...(existing || {}),
        cronExpression: existing?.cronExpression || manifestTask.defaultCron,
        defaultCron: manifestTask.defaultCron,
        description: manifestTask.description || null,
        enabled: existing?.enabled ?? manifestTask.enabled,
        handlerName: manifestTask.handlerName,
        installationId: input.installationId,
        pluginId: input.pluginId,
        runtimeStatus:
          existing?.runtimeStatus ||
          (manifestTask.enabled ? 'scheduled' : 'disabled'),
        taskKey: manifestTask.key,
        taskName: manifestTask.name,
        timeoutMs: manifestTask.timeoutMs,
      });
      tasks.push(await this.taskRepository.save(task));
    }
    return tasks;
  }
}
