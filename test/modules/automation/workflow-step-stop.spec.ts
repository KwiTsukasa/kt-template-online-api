import { WorkflowBusinessStepService } from '@/modules/workflow-engine/application/workflow-business-step.service';
import { WorkflowProcessRegistry } from '@/modules/workflow-engine/application/workflow-process.registry';
import { WorkflowScriptExecutionService } from '@/modules/workflow-engine/application/workflow-script-execution.service';
import type { WorkflowProcess } from '@/modules/workflow-engine/contract/workflow-process.interface';
import type { WorkflowNode } from '@/modules/workflow-engine/contract/workflow.types';
import { WorkflowNodeRun, WorkflowRun } from '@/modules/workflow-engine/infrastructure/persistence/workflow-run.entities';

const fixture = () => {
  const process = {
    prepareStep: jest.fn().mockResolvedValue({ reservation: 'media-run-123' }),
    acceptStep: jest.fn().mockResolvedValue({}),
    stopStep: jest.fn().mockResolvedValue(undefined),
  };
  const registry = { resolve: () => process as unknown as WorkflowProcess };
  const scripts = { advance: jest.fn().mockResolvedValue({ status: 'failed', results: [] }) };
  const service = new WorkflowBusinessStepService(
    registry as unknown as WorkflowProcessRegistry,
    scripts as unknown as WorkflowScriptExecutionService,
  );
  const state = Object.assign(new WorkflowNodeRun(), {
    nodeId: 'step', runId: '123', visit: 1, status: 'pending',
    preparedInput: null, businessReceipt: null, scriptAttempts: [], wakeAt: null,
  });
  const run = Object.assign(new WorkflowRun(), {
    id: '123', inputValues: {}, businessContext: {
      processRef: { key: 'media.governance', version: 1 },
      scopeId: 'work-1', subjectId: 'task-1', revision: 1, actorId: '7',
    },
  });
  const node: Extract<WorkflowNode, { type: 'business' }> = {
    id: 'step', type: 'business', name: '业务步骤', stepKey: 'media.check', scripts: [], input: {},
  };
  const manager = { save: jest.fn().mockResolvedValue(undefined) };
  const advance = (stop = false) => {
    state.wakeAt = null;
    return service.advance(node, state, run, new Map(), async () => { await manager.save(); }, stop);
  };
  return { process, scripts, state, advance };
};

describe('业务步骤停止与恢复', () => {
  it('业务释放暂时失败时保留等待，再次核对沿用原准备身份', async () => {
    const item = fixture();
    item.process.stopStep.mockRejectedValueOnce(new Error('数据库暂不可用'));
    await item.advance();
    expect(item.state.status).toBe('waiting');
    expect(item.state.errorMessage).toContain('释放步骤占用');
    expect(item.state.finishedAt).toBeNull();
    await item.advance();
    expect(item.state.status).toBe('failed');
    expect(item.process.prepareStep).toHaveBeenCalledTimes(1);
    expect(item.process.stopStep).toHaveBeenCalledTimes(2);
    expect(item.process.stopStep.mock.calls[1][0].prepared).toEqual({ reservation: 'media-run-123' });
  });

  it('业务验收拒绝成功脚本时仍释放该步骤的占用', async () => {
    const item = fixture();
    item.scripts.advance.mockResolvedValue({ status: 'succeeded', results: [] });
    item.process.acceptStep.mockRejectedValue(new Error('媒体证据缺失'));
    await item.advance();
    expect(item.state.status).toBe('failed');
    expect(item.process.stopStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('未知副作用不释放；明确取消回执才进入取消终态', async () => {
    const item = fixture();
    item.state.preparedInput = { reservation: 'media-run-123' };
    item.state.scriptAttempts = [{ status: 'unconfirmed' } as never];
    item.scripts.advance.mockRejectedValueOnce(new Error('读取回执失败'));
    await item.advance(true);
    expect(item.state.status).toBe('waiting');
    expect(item.process.stopStep).not.toHaveBeenCalled();
    item.state.scriptAttempts = [];
    item.scripts.advance.mockResolvedValue({ status: 'cancelled', results: [] });
    await item.advance(true);
    expect(item.state.status).toBe('cancelled');
    expect(item.process.stopStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });
});
