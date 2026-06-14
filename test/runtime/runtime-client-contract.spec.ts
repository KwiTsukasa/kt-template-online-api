import type {
  RuntimeDockerClientRequest,
  RuntimeHttpClientRequest,
  RuntimeProcessClientRequest,
} from '../../src/runtime';

describe('runtime client contracts', () => {
  it('uses explicit timeout and redaction fields for external calls', () => {
    const request: RuntimeHttpClientRequest = {
      url: 'https://example.invalid',
      method: 'GET',
      timeoutMs: 1000,
      correlationId: 'runtime-contract-test',
      safeSummary: 'fetch runtime contract fixture',
      redactHeaders: ['authorization'],
    };

    expect(request.timeoutMs).toBeGreaterThan(0);
    expect(request.redactHeaders).toContain('authorization');
    expect(request.safeSummary).toContain('runtime contract');
  });

  it('keeps process and docker requests explicit without secret-bearing fields', () => {
    const processRequest: RuntimeProcessClientRequest = {
      command: 'pnpm',
      args: ['run', 'typecheck'],
      cwd: 'D:\\MyFiles\\KT\\Node\\kt-template-online-api',
      timeoutMs: 1000,
      correlationId: 'runtime-contract-test',
      safeSummary: 'run api typecheck',
    };

    const dockerRequest: RuntimeDockerClientRequest = {
      action: 'exec',
      containerName: 'kt-template-online-api',
      command: ['pnpm', 'run', 'typecheck'],
      timeoutMs: 1000,
      correlationId: 'runtime-contract-test',
      safeSummary: 'exec api typecheck in container',
    };

    expect(processRequest.command).toBe('pnpm');
    expect(processRequest.args).toContain('typecheck');
    expect(dockerRequest.action).toBe('exec');
    expect(dockerRequest.command).toContain('typecheck');
  });
});
