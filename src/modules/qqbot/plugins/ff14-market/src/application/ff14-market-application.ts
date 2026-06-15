import { Ff14MarketClient } from '../infrastructure/integration/ff14-market-client';

export class Ff14MarketApplication {
  constructor(private readonly client: Ff14MarketClient) {}

  async getPrice(input: Record<string, any>) {
    return this.client.getPrice(input);
  }

  async resolveItem(input: Record<string, any>) {
    return this.client.resolveItem(input);
  }

  async checkHealth() {
    await this.client.resolveItem({ itemId: 2, language: 'en' });
    return true;
  }
}
