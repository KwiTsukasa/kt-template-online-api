export type RuntimeDockerClientAction =
  | 'exec'
  | 'run'
  | 'start'
  | 'stop'
  | 'restart'
  | 'logs'
  | 'inspect';

export interface RuntimeDockerClientRequest {
  action: RuntimeDockerClientAction;
  containerName?: string;
  image?: string;
  command?: string[];
  timeoutMs: number;
  correlationId: string;
  safeSummary: string;
}

export interface RuntimeDockerClientResponse {
  exitCode: number | null;
  output: string;
  timeoutMs: number;
  correlationId: string;
  safeSummary: string;
}
