export interface RuntimeProcessClientRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  correlationId: string;
  safeSummary: string;
}

export interface RuntimeProcessClientResponse {
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timeoutMs: number;
  correlationId: string;
  safeSummary: string;
}
