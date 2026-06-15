import { FflogsClient } from '../infrastructure/integration/fflogs-client';
import type { FflogsCharacterSummaryInput } from '../domain/fflogs.types';
import { parseFflogsCharacterInput } from './fflogs-input-parser';

export class FflogsApplication {
  constructor(private readonly client: FflogsClient) {}

  async getCharacterSummary(input: Record<string, any>) {
    return this.client.getCharacterSummary(
      input as FflogsCharacterSummaryInput,
    );
  }

  async parseCharacterInput(rawArgs: string) {
    const tokens = rawArgs.split(/\s+/).filter(Boolean);
    return parseFflogsCharacterInput(rawArgs, {
      resolveKnownWorld: await this.client.buildKnownWorldResolver(tokens),
    });
  }

  async checkHealth() {
    await this.client.checkHealth();
    return true;
  }
}
