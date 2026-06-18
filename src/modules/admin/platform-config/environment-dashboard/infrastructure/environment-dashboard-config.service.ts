import { Injectable, Optional } from '@nestjs/common';

export type EnvironmentDashboardConfigSource = Record<
  string,
  string | undefined
>;

@Injectable()
export class EnvironmentDashboardConfigService {
  /**
   * Initializes environment dashboard config access.
   * @param source - Optional test override; production falls back to process.env.
   */
  constructor(
    @Optional()
    private readonly source: EnvironmentDashboardConfigSource = process.env,
  ) {}

  /**
   * Reads one config value without exposing secrets to callers.
   * @param key - Public environment variable key used by dashboard integrations.
   * @returns Trimmed value or an empty string when absent.
   */
  get(key: string): string {
    return `${this.source[key] || ''}`.trim();
  }

  /**
   * Finds which required integration keys are absent.
   * @param keys - Public environment variable keys required by an adapter.
   * @returns Missing public key names for operator evidence.
   */
  missing(keys: string[]): string[] {
    return keys.filter((key) => !this.get(key));
  }
}
