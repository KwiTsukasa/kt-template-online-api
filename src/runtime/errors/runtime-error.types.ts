export type RuntimeErrorCategory =
  | 'config_error'
  | 'dependency_unavailable'
  | 'operation_failed'
  | 'cleanup_failed';

export interface RuntimeClassifiedError {
  category: RuntimeErrorCategory;
  operation: string;
  message: string;
  cause?: string;
  retryable: boolean;
}
