import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PluginTaskManifest } from '../../domain/manifest';
import { PluginTask } from '../../infrastructure/persistence';

export type SyncPluginManifestTasksInput = {
  installationId: string;
  manifestTasks: PluginTaskManifest[];
  pluginId: string;
};

@Injectable()
export class PluginTaskManifestSynchronizer {
  constructor(
    @InjectRepository(PluginTask)
    private readonly taskRepository: Repository<PluginTask>,
  ) {}

  /**
   * 根据`input`处理清单Tasks；把变更持久化到当前存储（`taskRepository.create`）。
   * @param input - 用于清单Tasks的结构化输入，包含 `manifestTasks`、`installationId`、`pluginId` 字段。
   * @returns 清单Tasks。
   */
  async syncManifestTasks(input: SyncPluginManifestTasksInput) {
    const tasks: PluginTask[] = [];
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
          ((() => {
            if (manifestTask.enabled) {
              return 'scheduled';
            }
            return 'disabled';
          })()),
        taskKey: manifestTask.key,
        taskName: manifestTask.name,
        timeoutMs: manifestTask.timeoutMs,
      });
      tasks.push(await this.taskRepository.save(task));
    }
    return tasks;
  }
}
