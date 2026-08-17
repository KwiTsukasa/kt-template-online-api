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

  /** 读取环境仪表盘配置记录。 */
  get(key: string): string {
    return `${this.source[key] || ''}`.trim();
  }

  /** 返回缺失的。 */
  missing(keys: string[]): string[] {
    return keys.filter((key) => !this.get(key));
  }
}
