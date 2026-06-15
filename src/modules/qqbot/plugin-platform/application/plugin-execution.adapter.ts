import { Injectable } from '@nestjs/common';
import type {
  QqbotPluginEventDispatchInput,
  QqbotPluginExecutionInput,
  QqbotPluginExecutionPort,
  QqbotPluginOperationLookup,
} from '@/modules/qqbot/core/domain/plugin-execution.port';
import { QqbotEventPluginRegistryService } from './registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from './registry/qqbot-plugin-registry.service';
import { QqbotPluginArgumentParserService } from './argument/qqbot-plugin-argument-parser.service';

@Injectable()
export class QqbotPluginExecutionAdapter implements QqbotPluginExecutionPort {
  constructor(
    private readonly argumentParser: QqbotPluginArgumentParserService,
    private readonly eventPluginRegistry: QqbotEventPluginRegistryService,
    private readonly pluginRegistry: QqbotPluginRegistryService,
  ) {}

  async executeOperation(input: QqbotPluginExecutionInput) {
    const normalizedInput = await this.argumentParser.normalizeInput(input);
    return this.pluginRegistry.execute(
      input.pluginKey,
      input.operationKey,
      normalizedInput,
      {
        ...(input.context || {}),
        args: normalizedInput,
      },
    );
  }

  async dispatchEvent(input: QqbotPluginEventDispatchInput) {
    if (input.eventKey !== 'message') return false;
    return this.eventPluginRegistry.dispatchMessage(input.message);
  }

  async listActiveOperations() {
    return [
      ...this.pluginRegistry.listOperations(),
      ...this.eventPluginRegistry.listOperations(),
    ];
  }

  async getOperationByCommand(command: QqbotPluginOperationLookup) {
    if (!command.pluginKey || !command.operationKey) return null;
    return (
      this.pluginRegistry
        .listOperations(command.pluginKey)
        .find((operation) => operation.key === command.operationKey) || null
    );
  }
}
