import { FflogsClient } from '../infrastructure/integration/fflogs-client';
import type { FflogsCharacterSummaryInput } from '../domain/fflogs.types';
import { parseFflogsCharacterInput } from './fflogs-input-parser';

export class FflogsApplication {
  constructor(private readonly client: FflogsClient) {}

  /**
   * 按`input`读取角色摘要；从 `client.getCharacterSummary` 读取角色摘要。
   * @param input - 用于角色摘要的结构化输入。
   * @returns 角色摘要。
   */
  async getCharacterSummary(input: Record<string, any>) {
    return this.client.getCharacterSummary(
      input as FflogsCharacterSummaryInput,
    );
  }

  /**
   * 将报告查询交由本插件的OAuth客户端执行，保持角色查询与报告查询的统一授权入口。
   * @param input - 完整报告参数和分页游标。
   * @returns 当前报告目录或事件数据页。
   */
  async getReport(input: Record<string, any>) {
    return this.client.getReport(input);
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param rawArgs - 决定角色输入内容、边界或目标的 `rawArgs` 值。
   * @returns 角色输入。
   */
  async parseCharacterInput(rawArgs: string) {
    const tokens = rawArgs.split(/\s+/).filter(Boolean);
    return parseFflogsCharacterInput(rawArgs, {
      resolveKnownWorld: await this.client.buildKnownWorldResolver(tokens),
    });
  }

  /**
   * 等待 FFLogs 客户端健康检查成功后返回 `true`；检查失败时保留拒绝状态。
   * @returns 满足等待 FFLogs 客户端健康检查成功后返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async checkHealth() {
    await this.client.checkHealth();
    return true;
  }
}
