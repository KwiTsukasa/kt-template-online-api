import { Ff14MarketClient } from '../infrastructure/integration/ff14-market-client';
import { parseFf14MarketPriceInput } from './ff14-market-input-parser';

export class Ff14MarketApplication {
  constructor(private readonly client: Ff14MarketClient) {}

  /**
   * 按`input`读取针对FF14 市场插件；从 `client.getPrice` 读取针对FF14 市场插件。
   * @param input - 用于针对FF14 市场插件的结构化输入。
   * @returns 针对FF14 市场插件。
   */
  async getPrice(input: Record<string, any>) {
    return this.client.getPrice(input);
  }

  /**
   * 从`rawArgs`解析Price输入；从 `client.getMarketCatalog` 读取Price输入。
   * @param rawArgs - 决定Price输入内容、边界或目标的 `rawArgs` 值。
   * @returns Price输入。
   */
  async parsePriceInput(rawArgs: string) {
    return parseFf14MarketPriceInput(
      rawArgs,
      await this.client.getMarketCatalog(),
    );
  }

  /**
   * 将市场查询条件交给 FF14 客户端解析，并返回匹配的物品目录记录。
   * @param input - 用于条目的结构化输入。
   * @returns 条目。
   */
  async resolveItem(input: Record<string, any>) {
    return this.client.resolveItem(input);
  }

  /**
   * 校验当前运行态是否满足针对FF14 市场插件约束，并拒绝不合法输入。
   * @returns 满足针对FF14 市场插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async checkHealth() {
    await this.client.resolveItem({ itemId: 2, language: 'en' });
    return true;
  }
}
