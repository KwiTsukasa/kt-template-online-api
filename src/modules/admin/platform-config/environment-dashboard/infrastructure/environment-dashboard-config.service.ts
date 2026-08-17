import { Injectable, Optional } from '@nestjs/common';

export type EnvironmentDashboardConfigSource = Record<
  string,
  string | undefined
>;

@Injectable()
export class EnvironmentDashboardConfigService {
  constructor(
    @Optional()
    private readonly source: EnvironmentDashboardConfigSource = process.env,
  ) {}

  /**
   * 从注入的环境源读取配置并去除两端空白，缺失值统一收敛为空字符串。
   * @param key - 要从环境配置源读取的变量名。
   * @returns 规范化后的配置文本；键不存在或值为空时返回空字符串。
   */
  get(key: string): string {
    return `${this.source[key] || ''}`.trim();
  }

  /**
   * 筛选配置源中值为空的键，保持调用方提供的键顺序。
   * @param keys - 决定配置源中值为空的键，保持调用方提供的键顺序内容、边界或目标的 `keys` 值。
   * @returns 返回配置值为空的键列表；全部已配置时为空数组。
   */
  missing(keys: string[]): string[] {
    return keys.filter((key) => !this.get(key));
  }
}
