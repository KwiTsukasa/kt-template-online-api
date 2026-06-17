import { Ff14MarketClient } from '../infrastructure/integration/ff14-market-client';
import { parseFf14MarketPriceInput } from './ff14-market-input-parser';

export class Ff14MarketApplication {
  /**
   * 初始化 Ff14MarketApplication 实例。
   * @param client - client 输入；影响 constructor 的返回值。
   */
  constructor(private readonly client: Ff14MarketClient) {}

  /**
   * 查询 FF14 市场插件数据。
   * @param input - input 输入；驱动 `client.getPrice()` 的 FF14 市场步骤。
   */
  async getPrice(input: Record<string, any>) {
    return this.client.getPrice(input);
  }

  /**
   * 解析Price Input。
   * @param rawArgs - FF14 市场列表；驱动 `parseFf14MarketPriceInput()` 的 FF14 市场步骤。
   */
  async parsePriceInput(rawArgs: string) {
    return parseFf14MarketPriceInput(
      rawArgs,
      await this.client.getMarketCatalog(),
    );
  }

  /**
   * 解析Item。
   * @param input - input 输入；驱动 `client.resolveItem()` 的 FF14 市场步骤。
   */
  async resolveItem(input: Record<string, any>) {
    return this.client.resolveItem(input);
  }

  /**
   * 执行 FF14 市场插件流程。
   */
  async checkHealth() {
    await this.client.resolveItem({ itemId: 2, language: 'en' });
    return true;
  }
}
