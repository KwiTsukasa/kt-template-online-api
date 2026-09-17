import { createWorkflowActivityState } from '@/modules/workflow-engine/domain/workflow-activity-state';
import type { WorkflowScriptBatchContext } from '@/modules/workflow-engine/contract/workflow-script.types';
import { WorkflowBusinessStepService } from '@/modules/workflow-engine/application/workflow-business-step.service';
import { AutomationValidationError } from '@/common/automation/validation';
import { WorkflowProcessRegistry } from '@/modules/workflow-engine/application/workflow-process.registry';
import { WorkflowScriptExecutionService } from '@/modules/workflow-engine/application/workflow-script-execution.service';
import type { WorkflowProcess } from '@/modules/workflow-engine/contract/workflow-process.interface';
import type { WorkflowBpmnStep } from '@/modules/workflow-engine/contract/workflow-bpmn.types';
import { WorkflowRun } from '@/modules/workflow-engine/infrastructure/persistence/workflow-run.entities';

const fixture = () => {
  const process = {
    prepareStep: jest.fn().mockResolvedValue({ reservation: 'media-run-123' }),
    acceptStep: jest.fn().mockResolvedValue({}),
    stopStep: jest.fn().mockResolvedValue(undefined),
  };
  const registry = { resolve: () => process as unknown as WorkflowProcess };
  const scripts = {
    advance: jest.fn().mockResolvedValue({ status: 'failed', results: [] }),
  };
  const service = new WorkflowBusinessStepService(
    registry as unknown as WorkflowProcessRegistry,
    scripts as unknown as WorkflowScriptExecutionService,
  );
  const state = Object.assign(createWorkflowActivityState(1), {
    nodeId: 'step',
    runId: '123',
    visit: 1,
    status: 'pending',
    preparedInput: null,
    businessReceipt: null,
    scriptAttempts: [],
    wakeAt: null,
  });
  const run = Object.assign(new WorkflowRun(), {
    id: '123',
    inputValues: {},
    businessContext: {
      processRef: { key: 'media.governance', version: 1 },
      scopeId: 'work-1',
      subjectId: 'task-1',
      revision: 1,
      actorId: '7',
    },
  });
  const node: Extract<WorkflowBpmnStep, { kind: 'business' }> & { id: string } =
    {
      id: 'step',
      kind: 'business',
      stepKey: 'media.check',
      scripts: [],
      input: {},
    };
  const manager = { save: jest.fn().mockResolvedValue(undefined) };
  const advance = (
    stop = false,
    readStopRequested?: () => Promise<boolean>,
  ) => {
    state.wakeAt = null;
    return service.advance(node, state, {
      runId: run.id,
      executionId: 'step-execution-1',
      deadlineAt: Date.now() + 60_000,
      input: run.inputValues,
      business: run.businessContext,
      progress: new Map(),
      control: {
        save: async () => {
          await manager.save();
        },
        shouldStop: async () => stop || Boolean(await readStopRequested?.()),
      },
    });
  };
  return { process, scripts, state, advance, manager };
};

describe('业务步骤停止与恢复', () => {
  it('准备阶段的确定映射拒绝进入失败终态，不循环等待或启动脚本', async () => {
    const item = fixture();
    item.process.prepareStep.mockRejectedValue(new AutomationValidationError('来源映射需要复核'));
    await item.advance();
    expect(item.state.status).toBe('failed');
    expect(item.state.wakeAt).toBeNull();
    expect(item.state.errorMessage).toBe('来源映射需要复核');
    expect(item.scripts.advance).not.toHaveBeenCalled();
    expect(item.process.stopStep).not.toHaveBeenCalled();
  });
  it('准备后的准入状态读取失败保持待恢复，不能误释放业务占用', async () => {
    const item = fixture();
    const failure = new Error('control state unavailable');
    const readStop = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockRejectedValue(failure);
    item.scripts.advance.mockImplementation(async (...args: unknown[]) => {
      await (args[3] as WorkflowScriptBatchContext).control.shouldStop();
      return { status: 'succeeded', results: [] };
    });
    await expect(item.advance(false, readStop)).rejects.toBe(failure);
    expect(item.process.prepareStep).toHaveBeenCalledTimes(1);
    expect(item.process.stopStep).not.toHaveBeenCalled();
    expect(item.process.acceptStep).not.toHaveBeenCalled();
  });
  it('保存步骤意图期间到达的取消不再生成业务准备授权', async () => {
    const item = fixture();
    const readStop = jest.fn().mockResolvedValue(false);
    item.manager.save.mockImplementation(async () => {
      readStop.mockResolvedValue(true);
    });
    await item.advance(false, readStop);
    expect(item.state.status).toBe('cancelled');
    expect(item.process.prepareStep).not.toHaveBeenCalled();
    expect(item.scripts.advance).not.toHaveBeenCalled();
  });
  it.each([2, 3])(
    '第 %i 次持久化失败向恢复层抛出，不能当成业务失败释放占用',
    async (failureAt) => {
      const item = fixture();
      const failure = new Error('database temporarily unavailable');
      let writes = 0;
      item.manager.save.mockImplementation(async () => {
        if (++writes === failureAt) throw failure;
      });
      item.scripts.advance.mockImplementation(async (...args: unknown[]) => {
        await (args[3] as WorkflowScriptBatchContext).control.save();
        return { status: 'succeeded', results: [] };
      });
      await expect(item.advance()).rejects.toBe(failure);
      expect(item.process.stopStep).not.toHaveBeenCalled();
      expect(item.process.acceptStep).not.toHaveBeenCalled();
    },
  );
  it('业务释放暂时失败时保留等待，再次核对沿用原准备身份', async () => {
    const item = fixture();
    item.process.stopStep.mockRejectedValueOnce(new Error('数据库暂不可用'));
    await expect(item.advance()).rejects.toThrow('数据库暂不可用');
    expect(item.state.status).toBe('waiting');
    expect(item.state.finishedAt).toBeNull();
    await item.advance();
    expect(item.state.status).toBe('failed');
    expect(item.process.prepareStep).toHaveBeenCalledTimes(1);
    expect(item.process.stopStep).toHaveBeenCalledTimes(2);
    expect(item.process.stopStep.mock.calls[1][0].prepared).toEqual({
      reservation: 'media-run-123',
    });
  });

  it('业务验收拒绝成功脚本时仍释放该步骤的占用', async () => {
    const item = fixture();
    item.scripts.advance.mockResolvedValue({
      status: 'succeeded',
      results: [],
    });
    item.process.acceptStep.mockRejectedValue(
      new AutomationValidationError('媒体证据缺失'),
    );
    await item.advance();
    expect(item.state.status).toBe('failed');
    expect(item.process.stopStep).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it.each(['prepareStep', 'acceptStep'] as const)(
    '业务 %s 的技术故障不能触发失败收尾或释放占用',
    async (operation) => {
      const item = fixture();
      const failure = new Error('数据库连接中断');
      item.scripts.advance.mockResolvedValue({
        status: 'succeeded',
        results: [],
      });
      item.process[operation].mockRejectedValue(failure);
      await expect(item.advance()).rejects.toBe(failure);
      expect(item.process.stopStep).not.toHaveBeenCalled();
    },
  );

  it('未知副作用不释放；明确取消回执才进入取消终态', async () => {
    const item = fixture();
    item.state.preparedInput = { reservation: 'media-run-123' };
    item.state.scriptAttempts = [{ status: 'unconfirmed' } as never];
    item.scripts.advance.mockRejectedValueOnce(new Error('读取回执失败'));
    await expect(item.advance(true)).rejects.toThrow('读取回执失败');
    expect(item.state.status).toBe('waiting');
    expect(item.process.stopStep).not.toHaveBeenCalled();
    item.state.scriptAttempts = [];
    item.scripts.advance.mockResolvedValue({
      status: 'cancelled',
      results: [],
    });
    await item.advance(true);
    expect(item.state.status).toBe('cancelled');
    expect(item.process.stopStep).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });
});
