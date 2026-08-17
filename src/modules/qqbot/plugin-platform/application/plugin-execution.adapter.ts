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
  constructor(private readonly platformService: QqbotPluginPlatformService) {}

  /**
   * 将插件能力执行请求交给平台服务，并采用其异步执行结果。
   * @param input - 用于操作的结构化输入。
   * @returns 操作。
   */
  async executeOperation(input: QqbotPluginExecutionInput) {
    return this.platformService.executeOperation(input);
  }

  /**
   * 将插件事件分发请求交给平台服务，并采用其异步分发结果。
   * @param input - 用于事件的结构化输入。
   * @returns 事件。
   */
  async dispatchEvent(input: QqbotPluginEventDispatchInput) {
    return this.platformService.dispatchEvent(input);
  }

  /**
   * 按当前运行态读取启用状态操作集合；从 `platformService.listActiveOperations` 读取启用状态操作集合。
   * @returns 启用状态操作集合。
   */
  async listActiveOperations() {
    return this.platformService.listActiveOperations();
  }

  /**
   * 按`command`读取操作命令；从 `platformService.getOperationByCommand` 读取操作命令。
   * @param command - 决定操作命令内容、边界或目标的 `command` 值。
   * @returns 操作命令。
   */
  async getOperationByCommand(command: QqbotPluginOperationLookup) {
    return this.platformService.getOperationByCommand(command);
  }
}
