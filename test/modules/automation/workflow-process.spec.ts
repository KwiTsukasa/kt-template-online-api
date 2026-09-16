import { AbstractWorkflowProcess } from '@/modules/workflow-engine/contract/abstract-workflow-process';
import type {
  WorkflowLaunchContext,
  WorkflowStepInvocation,
  WorkflowStepStop,
} from '@/modules/workflow-engine/contract/workflow-process.interface';
import { WorkflowProcessRegistry } from '@/modules/workflow-engine/application/workflow-process.registry';
import { parseWorkflowScriptUpload } from '@/modules/workflow-engine/domain/workflow-script-upload.policy';
import { normalizeWorkflowScripts } from '@/modules/workflow-engine/domain/workflow-script.policy';

class ReceiptProcess extends AbstractWorkflowProcess {
  readonly key = 'test.receipt';
  readonly version = 1;
  readonly name = '操作回执核对';
  readonly inputSchema = { fields: [] };
  readonly outputSchema = { fields: [] };
  readonly steps = [
    {
      key: 'receipt.check',
      name: '核对操作',
      description: '只核对同一操作',
      inputSchema: {
        fields: [
          {
            key: 'amount',
            label: '数量',
            type: 'integer' as const,
            required: true,
            min: 1,
          },
        ],
      },
      outputSchema: {
        fields: [
          {
            key: 'accepted',
            label: '验收通过',
            type: 'boolean' as const,
            required: true,
          },
        ],
      },
    },
  ];
  prepare = async (context: WorkflowLaunchContext) => ({
    identity: context,
    input: {},
  });
  prepareStepInput = jest.fn<
    Promise<Record<string, unknown>>,
    [WorkflowStepInvocation]
  >();
  verifyStep = jest.fn<Promise<Record<string, unknown>>, [unknown]>();
  verifyResult = jest.fn<Promise<void>, [unknown]>();
  releaseStep = jest.fn<Promise<void>, [WorkflowStepStop]>();
}
const invocation = (): WorkflowStepInvocation => ({
  business: { scopeId: 'work-123', subjectId: 'task-123', revision: 4 },
  actorId: '7',
  executionKey: 'workflow:123:receipt',
  stepKey: 'receipt.check',
  input: { amount: 1 },
  receipt: null,
  stopRequested: false,
  signal: new AbortController().signal,
});
const result = {
  executionId: 'a'.repeat(64),
  script: { key: 'test.script', version: 1, sha256: 'b'.repeat(64) },
  status: 'succeeded' as const,
  exitCode: 0,
  output: {},
};

describe('工作流业务接口与脚本标准', () => {
  it('失败与取消只在全部脚本确认退出后释放占用，尚未派发的步骤也能收尾', async () => {
    const process = new ReceiptProcess();
    const context: WorkflowStepStop = {
      invocation: invocation(), prepared: { mediaRunId: 'media-run-1' },
      status: 'cancelled', attempts: [],
    };
    await process.stopStep(context);
    expect(process.releaseStep).toHaveBeenCalledWith(context);
    process.releaseStep.mockClear();
    for (const status of ['running', 'unconfirmed'] as const) {
      await expect(process.stopStep({ ...context, attempts: [{
        ...result, status, index: 0, attempt: 1,
        startedAt: new Date().toISOString(), finishedAt: null,
      }] })).rejects.toThrow('尚未确认停止');
    }
    expect(process.releaseStep).not.toHaveBeenCalled();
  });
  it('非法输入、停止意图和取消信号在业务准备之前拒绝', async () => {
    const process = new ReceiptProcess();
    await expect(
      process.prepareStep({ ...invocation(), input: { amount: 0 } }),
    ).rejects.toThrow('最小值');
    await expect(
      process.prepareStep({
        ...invocation(),
        input: { amount: 1, unknown: true },
      }),
    ).rejects.toThrow('未声明');
    await expect(
      process.prepareStep({ ...invocation(), stopRequested: true }),
    ).rejects.toThrow('停止');
    await expect(
      process.prepareStep({ ...invocation(), signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(process.prepareStepInput).not.toHaveBeenCalled();
  });
  it('准备结果禁止隐藏执行函数，参数快照与业务内存隔离', async () => {
    const process = new ReceiptProcess();
    process.prepareStepInput.mockResolvedValue({ execute: () => 'forbidden' });
    await expect(process.prepareStep(invocation())).rejects.toThrow(
      '普通 JSON',
    );
    const prepared = { amount: 1 };
    process.prepareStepInput.mockResolvedValue(prepared);
    const snapshot = await process.prepareStep(invocation());
    snapshot.amount = 9;
    expect(prepared.amount).toBe(1);
  });
  it('无成功脚本回执不能验收，业务验收结果仍必须符合输出契约', async () => {
    const process = new ReceiptProcess();
    const acceptance = { invocation: invocation(), prepared: {}, results: [] };
    await expect(process.acceptStep(acceptance)).rejects.toThrow(
      '真实成功回执',
    );
    expect(process.verifyStep).not.toHaveBeenCalled();
    process.verifyStep.mockResolvedValue({});
    await expect(
      process.acceptStep({ ...acceptance, results: [result] }),
    ).rejects.toThrow();
    process.verifyStep.mockResolvedValue({ accepted: true });
    expect(
      await process.acceptStep({ ...acceptance, results: [result] }),
    ).toEqual({ accepted: true });
  });
  it('图到达终点仍需读取业务最终证据', async () => {
    const process = new ReceiptProcess();
    process.verifyResult.mockRejectedValue(new Error('媒体机械验收证据缺失'));
    await expect(
      process.complete({ business: invocation().business, output: {} }),
    ).rejects.toThrow('机械验收');
  });
  it('目录隔离内部状态，精确版本缺失、重复与注册后漂移均拒绝', () => {
    const registry = new WorkflowProcessRegistry();
    const process = new ReceiptProcess();
    const release = registry.register(process);
    registry.catalog()[0].steps[0].inputSchema.fields[0].label = '外部修改';
    expect(registry.resolve(process).steps[0].inputSchema.fields[0].label).toBe(
      '数量',
    );
    expect(() => registry.register(process)).toThrow('重复');
    expect(() => registry.resolve({ key: process.key, version: 2 })).toThrow(
      '未加载',
    );
    process.steps[0].inputSchema.fields[0].required = false;
    expect(() => registry.resolve(process)).toThrow('发生变化');
    release();
    expect(() => registry.resolve(process)).toThrow('未加载');
  });
  it('上传静态识别声明参数，拒绝缺失协议和越界扩展标准字段', () => {
    const declaration = {
      protocol: 'kt.workflow.script.v1',
      key: 'test.script',
      name: '上传测试',
      description: '自动识别参数',
      processKey: 'test.receipt',
      stepKey: 'receipt.check',
      maxTimeoutMs: 60_000,
      idempotent: false,
      paramsSchema: {
        fields: [
          {
            key: 'quality',
            label: '画质',
            type: 'string',
            required: true,
            options: [{ label: '原画', value: 'original' }],
          },
        ],
      },
      resultSchema: { fields: [] },
      defaults: { quality: 'original' },
    };
    const source = (metadata: unknown) =>
      `/* @kt-workflow-script\n${JSON.stringify(metadata)}\n@end-kt-workflow-script */\nthrow new Error('不应在识别期间执行');`;
    expect(
      parseWorkflowScriptUpload('sample.mjs', source(declaration)),
    ).toMatchObject({
      paramsSchema: declaration.paramsSchema,
      defaults: declaration.defaults,
      runtime: 'node',
    });
    const bashSource =
      '#!/usr/bin/env bash\n# @kt-workflow-script\n' +
      JSON.stringify(declaration, null, 2)
        .split('\n')
        .map((line) => '# ' + line)
        .join('\n') +
      '\n# @end-kt-workflow-script\nexit 1\n';
    const bash = parseWorkflowScriptUpload('sample.sh', bashSource);
    expect(bash).toMatchObject({
      runtime: 'bash',
      paramsSchema: declaration.paramsSchema,
      defaults: declaration.defaults,
    });
    expect(
      parseWorkflowScriptUpload(
        'sample.SH',
        '\uFEFF' + bashSource.replace(/\n/g, '\r\n'),
      ).sha256,
    ).toBe(bash.sha256);
    expect(() =>
      parseWorkflowScriptUpload('sample.sh', bashSource.replace('# {', '{')),
    ).toThrow('每行必须');
    expect(() =>
      parseWorkflowScriptUpload('sample.mjs', 'console.log(1)'),
    ).toThrow('声明区');
    expect(() =>
      parseWorkflowScriptUpload(
        'sample.mjs',
        source({ ...declaration, protocol: 'custom' }),
      ),
    ).toThrow('标准输入输出');
    expect(() =>
      parseWorkflowScriptUpload(
        'sample.mjs',
        source({ ...declaration, customBusinessField: 1 }),
      ),
    ).toThrow('未知字段');
    expect(() =>
      parseWorkflowScriptUpload(
        'sample.mjs',
        source({ ...declaration, defaults: { quality: 'wrong' } }),
      ),
    ).toThrow('允许的选项');
  });
  it('有序脚本只保存精确版本和业务参数映射，禁止自由命令', () => {
    const call = {
      key: 'test.script',
      version: 1,
      sha256: 'b'.repeat(64),
      timeoutMs: 1000,
      maxAttempts: 1,
      retryBackoffMs: 1000,
      params: {},
    };
    expect(
      normalizeWorkflowScripts([call, { ...call, key: 'test.next' }]).map(
        (script) => script.key,
      ),
    ).toEqual(['test.script', 'test.next']);
    expect(() =>
      normalizeWorkflowScripts([{ ...call, command: 'arbitrary' }]),
    ).toThrow('固定脚本引用');
  });
});
