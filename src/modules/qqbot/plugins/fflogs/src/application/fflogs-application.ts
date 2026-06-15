import { FflogsClient } from '../infrastructure/integration/fflogs-client';
import type { QqbotFflogsCharacterSummaryInput } from '../domain/fflogs.types';

export class FflogsApplication {
  constructor(private readonly client: FflogsClient) {}

  async getCharacterSummary(input: Record<string, any>) {
    return this.client.getCharacterSummary(
      input as QqbotFflogsCharacterSummaryInput,
    );
  }

  async checkHealth() {
    await this.client.checkHealth();
    return true;
  }
}
