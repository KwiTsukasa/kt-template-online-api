export interface RuntimeHttpClientRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown> | ArrayBuffer | null;
  timeoutMs: number;
  correlationId: string;
  safeSummary: string;
  redactHeaders?: string[];
}

export interface RuntimeHttpClientResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  correlationId: string;
  safeSummary: string;
}
