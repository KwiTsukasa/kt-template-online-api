import { createWorkflowActivityState } from '@/modules/workflow-engine/domain/workflow-activity-state';
import { WorkflowScriptExecutionService } from '@/modules/workflow-engine/application/workflow-script-execution.service';
import type { WorkflowScriptRegistry } from '@/modules/workflow-engine/application/workflow-script.registry';
import type { WorkflowScriptRunner } from '@/modules/workflow-engine/infrastructure/workflow-script.runner';
import type { WorkflowScriptCall } from '@/modules/workflow-engine/contract/workflow-script.types';
import type { WorkflowStepInvocation } from '@/modules/workflow-engine/contract/workflow-process.interface';

const calls: WorkflowScriptCall[] = ['first', 'second'].map((key) => ({
  key: `test.${key}`,
  version: 1,
  sha256: 'a'.repeat(64),
  timeoutMs: 1000,
  maxAttempts: 1,
  retryBackoffMs: 1000,
  params: {},
}));
const fixture = () => {
  let stopping = false;
  const state = Object.assign(createWorkflowActivityState(1), {
    preparedInput: {},
    scriptAttempts: [],
  });
  const registry = {
    check: () => ({
      defaults: {},
      paramsSchema: { fields: [] },
      resultSchema: { fields: [] },
      target: 'local',
    }),
  };
  const runner = {
    start: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    read: jest.fn(async (executionId: string) => {
      stopping = true;
      const attempt = state.scriptAttempts!.find(
        (item) => item.executionId === executionId,
      )!;
      return {
        executionId,
        script: attempt.script,
        status: 'succeeded',
        exitCode: 0,
        output: {},
      };
    }),
  };
  const invocation: WorkflowStepInvocation = {
    business: { scopeId: 'scope', subjectId: 'subject', revision: 1 },
    actorId: '7',
    stepKey: 'test.step',
    executionKey: 'workflow:test:123',
    input: {},
    receipt: null,
    stopRequested: false,
    signal: new AbortController().signal,
  };
  const service = new WorkflowScriptExecutionService(
    registry as unknown as WorkflowScriptRegistry,
    runner as unknown as WorkflowScriptRunner,
  );
  return {
    state,
    runner,
    invocation,
    service,
    readStop: async () => stopping,
    stop: () => {
      stopping = true;
    },
  };
};

describe('脚本派发持续受父流程控制', () => {
  it('前一脚本结束期间收到取消后，禁止启动后一脚本', async () => {
    const item = fixture();
    const result = await item.service.advance(
      calls,
      item.invocation,
      item.state,
      {
        processKey: 'test.business',
        params: [{}, {}],
        control: { save: async () => undefined, shouldStop: item.readStop },
      },
    );
    expect(item.runner.start).toHaveBeenCalledTimes(1);
    expect(item.state.scriptAttempts).toHaveLength(1);
    expect(result.status).toBe('cancelled');
  });

  it('业务准备期间已取消的步骤不再分配新的脚本尝试', async () => {
    const item = fixture();
    item.stop();
    const result = await item.service.advance(
      calls,
      item.invocation,
      item.state,
      {
        processKey: 'test.business',
        params: [{}, {}],
        control: { save: async () => undefined, shouldStop: item.readStop },
      },
    );
    expect(item.runner.start).not.toHaveBeenCalled();
    expect(item.state.scriptAttempts).toHaveLength(0);
    expect(result.status).toBe('cancelled');
  });
});
