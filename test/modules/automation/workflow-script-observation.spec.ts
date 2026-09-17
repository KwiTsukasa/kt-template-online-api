import { normalizeWorkflowScriptObservation } from '@/modules/workflow-engine/domain/workflow-script-observation.policy';

const executionId = 'a'.repeat(64);
const result = () => ({
  executionId,
  script: { key: 'test.script', version: 1, sha256: 'b'.repeat(64) },
  status: 'succeeded',
  exitCode: 0,
  output: { amount: 3 },
});

describe('脚本回执的统一合同', () => {
  it.each([false, true])(
    '本地与 NAS 使用相同终态投影，远端查询=%s',
    (remote) => {
      const raw = {
        ...result(),
        error: null,
        finishedAt: '2026-09-17T00:00:00.000Z',
      };
      const normalized = normalizeWorkflowScriptObservation(
        raw,
        executionId,
        remote,
      );
      expect(normalized).toEqual(result());
      raw.output.amount = 999;
      if ('output' in normalized)
        expect(normalized.output).toEqual({ amount: 3 });
    },
  );

  it.each(['running', 'unconfirmed'])(
    '活动状态 %s 只允许来自状态查询，不能伪装成本地终态文件',
    (status) => {
      expect(
        normalizeWorkflowScriptObservation(
          { executionId, status, output: { fake: true } },
          executionId,
          true,
        ),
      ).toEqual({ executionId, status });
      expect(() =>
        normalizeWorkflowScriptObservation(
          { executionId, status },
          executionId,
          false,
        ),
      ).toThrow('退出状态');
    },
  );

  it.each([
    { executionId: 'other' },
    { script: null },
    { script: { key: 'bad key', version: 1, sha256: 'b'.repeat(64) } },
    { script: { key: 'test.script', version: 0, sha256: 'b'.repeat(64) } },
    { script: { key: 'test.script', version: 1, sha256: 'missing' } },
    { exitCode: null },
    { exitCode: 1 },
    { exitCode: -1 },
    { exitCode: '0' },
    { status: 'unknown' },
    { output: [] },
    { output: { amount: Number.NaN } },
  ])('拒绝损坏的身份、脚本引用或伪成功 %j', (patch) => {
    expect(() =>
      normalizeWorkflowScriptObservation(
        { ...result(), ...patch },
        executionId,
        true,
      ),
    ).toThrow();
  });

  it.each(['failed', 'cancelled'])(
    '%s 可保留由信号终止形成的空退出码',
    (status) => {
      expect(
        normalizeWorkflowScriptObservation(
          { ...result(), status, exitCode: null },
          executionId,
          true,
        ),
      ).toMatchObject({ status, exitCode: null });
    },
  );
});
