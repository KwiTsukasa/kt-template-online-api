import { Injectable } from '@nestjs/common';
import type {
  BotPluginEventDispatchInput,
  BotPluginOperationInput,
  BotPluginOperationLookup,
  BotPluginProtocol,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import { PluginPlatformService } from './plugin-platform.service';

@Injectable()
export class PluginExecutionAdapter implements BotPluginProtocol {
  constructor(private readonly platformService: PluginPlatformService) {}

  /**
   * 将插件能力执行请求交给平台服务，并采用其异步执行结果。
   * @param input - 用于操作的结构化输入。
   * @returns 操作。
   */
  async executeOperation(input: BotPluginOperationInput) {
    return this.platformService.executeOperation(input);
  }

  /**
   * 将插件事件分发请求交给平台服务，并采用其异步分发结果。
   * @param input - 用于事件的结构化输入。
   * @returns 事件。
   */
  async dispatchEvent(input: BotPluginEventDispatchInput) {
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
   * 读取平台当前可供任意 BotAdapter 绑定的无账号插件目录。
   * @returns 启用插件摘要。
   */
  async listPlugins() {
    return this.platformService.listPlugins();
  }

  /**
   * 按`command`读取操作命令；从 `platformService.getOperationByCommand` 读取操作命令。
   * @param command - 决定操作命令内容、边界或目标的 `command` 值。
   * @returns 操作命令。
   */
  async getOperationByCommand(command: BotPluginOperationLookup) {
    return this.platformService.getOperationByCommand(command);
  }
}
