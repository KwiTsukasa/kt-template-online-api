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

  async executeOperation(input: QqbotPluginExecutionInput) {
    return this.platformService.executeOperation(input);
  }

  async dispatchEvent(input: QqbotPluginEventDispatchInput) {
    return this.platformService.dispatchEvent(input);
  }

  async listActiveOperations() {
    return this.platformService.listActiveOperations();
  }

  async getOperationByCommand(command: QqbotPluginOperationLookup) {
    return this.platformService.getOperationByCommand(command);
  }
}
