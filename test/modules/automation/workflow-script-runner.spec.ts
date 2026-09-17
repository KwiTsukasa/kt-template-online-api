import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { WorkflowScriptRunner } from '@/modules/workflow-engine/infrastructure/workflow-script.runner';
import { WorkflowNasTransport } from '@/modules/workflow-engine/infrastructure/workflow-nas.transport';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock(
  '@/modules/workflow-engine/infrastructure/workflow-nas.transport',
  () => ({ WorkflowNasTransport: jest.fn() }),
);

const executionId = 'a'.repeat(64);
const terminal = {
  executionId,
  status: 'succeeded',
  script: { key: 'test.script', version: 1, sha256: 'b'.repeat(64) },
  exitCode: 0,
  output: { amount: 3 },
};
const remoteRequest = jest.fn();
const create = () => {
  jest
    .mocked(WorkflowNasTransport)
    .mockImplementation(
      () => ({ request: remoteRequest }) as unknown as WorkflowNasTransport,
    );
  return new WorkflowScriptRunner(
    new ConfigService({
      WORKFLOW_SCRIPT_STATE_ROOT: path.resolve(__dirname, 'unused-state'),
    }),
  );
};

afterEach(() => jest.restoreAllMocks());

describe('工作流脚本状态读取', () => {
  it.each(['local', 'nas'] as const)(
    '%s 只返回共同结果合同，剔除包装器诊断字段',
    async (target) => {
      const raw = {
        ...terminal,
        error: null,
        finishedAt: '2026-09-17T00:00:00.000Z',
      };
      jest.mocked(readFile).mockResolvedValue(JSON.stringify(raw));
      remoteRequest.mockResolvedValue(raw);
      await expect(create().read(executionId, target)).resolves.toEqual(
        terminal,
      );
    },
  );

  it.each([-1000, 0, 9999, 10000, Number.NaN])(
    '心跳年龄 %s 毫秒的活动性有明确边界',
    async (age) => {
      const now = Date.parse('2026-09-17T00:00:00.000Z');
      jest.spyOn(Date, 'now').mockReturnValue(now);
      let observedAt = 'invalid';
      if (Number.isFinite(age)) observedAt = new Date(now - age).toISOString();
      jest.mocked(readFile).mockImplementation(async (file) => {
        if (String(file).endsWith('result.json'))
          throw Object.assign(new Error('absent'), { code: 'ENOENT' });
        return JSON.stringify({ executionId, observedAt });
      });
      let status = 'unconfirmed';
      if (age >= 0 && age < 10000) status = 'running';
      await expect(create().read(executionId)).resolves.toEqual({
        executionId,
        status,
      });
    },
  );
});
