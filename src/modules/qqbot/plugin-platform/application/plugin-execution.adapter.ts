import { Injectable } from '@nestjs/common';
import type {
  QqbotPluginEventDispatchInput,
  QqbotPluginExecutionInput,
  QqbotPluginExecutionPort,
  QqbotPluginOperationLookup,
} from '@/modules/qqbot/core/domain/plugin-execution.port';
import { QqbotPluginPlatformService } from './plugin-platform.service';

@Injectable()
export class QqbotPluginExecutionAdapter implements QqbotPluginExecutionPort {
  /**
   * 初始化 QqbotPluginExecutionAdapter 实例。
   * @param platformService - platformService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly platformService: QqbotPluginPlatformService) {}

  /**
   * 执行Operation。
   * @param input - input 输入；驱动 `platformService.executeOperation()` 的 插件平台步骤。
   */
  async executeOperation(input: QqbotPluginExecutionInput) {
    return this.platformService.executeOperation(input);
  }

  /**
   * 投递 QQBot 插件平台消息或任务。
   * @param input - input 输入；驱动 `platformService.dispatchEvent()` 的 插件平台步骤。
   */
  async dispatchEvent(input: QqbotPluginEventDispatchInput) {
    return this.platformService.dispatchEvent(input);
  }

  /**
   * 列出Active Operations。
   */
  async listActiveOperations() {
    return this.platformService.listActiveOperations();
  }

  /**
   * 查询 QQBot 插件平台数据。
   * @param command - command 输入；驱动 `platformService.getOperationByCommand()` 的 插件平台步骤。
   */
  async getOperationByCommand(command: QqbotPluginOperationLookup) {
    return this.platformService.getOperationByCommand(command);
  }
}
