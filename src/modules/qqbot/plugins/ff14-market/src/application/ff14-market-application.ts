import { Ff14MarketClient } from '../infrastructure/integration/ff14-market-client';
import { parseFf14MarketPriceInput } from './ff14-market-input-parser';

export class Ff14MarketApplication {
  constructor(private readonly client: Ff14MarketClient) {}

  async getPrice(input: Record<string, any>) {
    return this.client.getPrice(input);
  }

  async parsePriceInput(rawArgs: string) {
    return parseFf14MarketPriceInput(
      rawArgs,
      await this.client.getMarketCatalog(),
    );
  }

  async resolveItem(input: Record<string, any>) {
    return this.client.resolveItem(input);
  }

  async checkHealth() {
    await this.client.resolveItem({ itemId: 2, language: 'en' });
    return true;
  }
}
