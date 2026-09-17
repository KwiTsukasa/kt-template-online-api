import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { WorkflowNasTransport } from '@/modules/workflow-engine/infrastructure/workflow-nas.transport';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

const executionId = 'a'.repeat(64);
const fixture = (value: unknown = {}) => {
  let input = '';
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
  child.stdin.on('data', (data) => {
    input += data.toString();
  });
  child.stdin.on('finish', () => {
    child.stdout.write(JSON.stringify({ executionId, value }));
    child.stdout.end();
    child.emit('close', 0);
  });
  jest
    .mocked(spawn)
    .mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  jest.mocked(readFile).mockResolvedValue('remote controller source');
  const transport = new WorkflowNasTransport(
    new ConfigService({
      WORKFLOW_NAS_SSH_HOST: 'nas',
      WORKFLOW_NAS_STATE_ROOT: '/safe/workflow',
      WORKFLOW_NAS_NODE_BINARY: '/usr/bin/node',
    }),
  );
  return {
    transport,
    request: () => JSON.parse(input) as Record<string, unknown>,
    child,
  };
};

afterEach(() => jest.restoreAllMocks());

describe('工作流 NAS 控制封套', () => {
  it('载荷不能覆盖已核验的操作、尝试身份和受控路径', async () => {
    const item = fixture();
    await item.transport.request('read', executionId, {
      operation: 'cancel',
      executionId: 'other',
      root: '/',
      nodeBinary: '/untrusted/node',
    });
    expect(item.request()).toMatchObject({
      operation: 'read',
      executionId,
      root: '/safe/workflow',
      nodeBinary: '/usr/bin/node',
    });
  });

  it('允许合法的一 MiB 业务结果及其标准身份封套', async () => {
    const output = { blob: 'x'.repeat(1024 * 1024 - 11) };
    expect(Buffer.byteLength(JSON.stringify(output))).toBe(1024 * 1024);
    const value = {
      executionId,
      status: 'succeeded',
      exitCode: 0,
      script: { key: 'test.script', version: 1, sha256: 'b'.repeat(64) },
      output,
    };
    const item = fixture(value);
    await expect(item.transport.request('read', executionId)).resolves.toEqual(
      value,
    );
  });

  it('控制程序从发布目录定位，不受调用进程的当前目录影响', async () => {
    const item = fixture();
    const expected = path.resolve(
      __dirname,
      '../../../scripts/workflow/remote-control.cjs',
    );
    const previous = process.cwd();
    try {
      process.chdir(path.parse(expected).root);
      await item.transport.request('read', executionId);
      expect(readFile).toHaveBeenLastCalledWith(expected, 'utf8');
    } finally {
      process.chdir(previous);
    }
  });
});
