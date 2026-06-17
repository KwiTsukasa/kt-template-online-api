import { FflogsClient } from '../infrastructure/integration/fflogs-client';
import type { FflogsCharacterSummaryInput } from '../domain/fflogs.types';
import { parseFflogsCharacterInput } from './fflogs-input-parser';

export class FflogsApplication {
  /**
   * 初始化 FflogsApplication 实例。
   * @param client - client 输入；影响 constructor 的返回值。
   */
  constructor(private readonly client: FflogsClient) {}

  /**
   * 查询 FFLogs 插件数据。
   * @param input - input 输入；驱动 `client.getCharacterSummary()` 的 FFLogs步骤。
   */
  async getCharacterSummary(input: Record<string, any>) {
    return this.client.getCharacterSummary(
      input as FflogsCharacterSummaryInput,
    );
  }

  /**
   * 解析Character Input。
   * @param rawArgs - FFLogs列表；生成规范化文本。
   */
  async parseCharacterInput(rawArgs: string) {
    const tokens = rawArgs.split(/\s+/).filter(Boolean);
    return parseFflogsCharacterInput(rawArgs, {
      resolveKnownWorld: await this.client.buildKnownWorldResolver(tokens),
    });
  }

  /**
   * 执行 FFLogs 插件流程。
   */
  async checkHealth() {
    await this.client.checkHealth();
    return true;
  }
}
