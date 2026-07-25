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

  get(key: string): string {
    return `${this.source[key] || ''}`.trim();
  }

  missing(keys: string[]): string[] {
    return keys.filter((key) => !this.get(key));
  }
}
