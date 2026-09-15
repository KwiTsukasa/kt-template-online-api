import { TaskHandlerRegistry } from '@/modules/task-execution/application/task-handler.registry';
import { TaskDefinitionService } from '@/modules/task-execution/application/task-definition.service';
import { normalizeAtomicTaskDefinition } from '@/modules/task-execution/domain/task-definition.policy';
import {
  bindWorkflowValues,
  nodeReadiness,
} from '@/modules/workflow-engine/domain/workflow-execution.policy';
import type { NodeProgress } from '@/modules/workflow-engine/domain/workflow-execution.policy';
import type { WorkflowEdge } from '@/modules/workflow-engine/contract/workflow.types';

const schema = {
  fields: [
    { key: 'amount', label: '金额', type: 'number' as const, required: true },
  ],
};
const handler = {
  key: 'test.amount',
  version: 1,
  name: '金额处理',
  ownerKind: 'system',
  timeoutMs: 5000,
  idempotent: false,
  inputSchema: schema,
  outputSchema: schema,
  isAvailable: async () => true,
  execute: async () => ({ amount: 1 }),
};
const definition = {
  schemaVersion: 1,
  handler: { key: handler.key, version: 1 },
  contract: {
    inputSchema: schema,
    outputSchema: schema,
    idempotent: false,
    ownerKind: 'system',
  },
  timeoutMs: 5000,
  maxAttempts: 1,
  retryBackoffMs: 1000,
};

describe('原子执行契约', () => {
  it('拒绝把触发器、规则或流程塞回原子任务', () => {
    for (const key of ['trigger', 'rule', 'workflow'])
      expect(() =>
        normalizeAtomicTaskDefinition({ ...definition, [key]: {} }),
      ).toThrow('原子任务不接受');
  });
  it('MySQL JSON 属性重排不构成契约变化，字段类型变化才拒绝', async () => {
    const registry = new TaskHandlerRegistry();
    registry.register(handler);
    const service = new TaskDefinitionService({} as never, registry);
    const saved = normalizeAtomicTaskDefinition(definition);
    const reordered = JSON.parse(JSON.stringify(saved));
    reordered.contract = {
      ownerKind: 'system',
      idempotent: false,
      outputSchema: schema,
      inputSchema: {
        fields: [
          { required: true, type: 'number', label: '金额', key: 'amount' },
        ],
      },
    };
    expect(service.matchesContract(reordered)).toBe(true);
    reordered.contract.inputSchema.fields[0].type = 'string';
    expect(service.matchesContract(reordered)).toBe(false);
    await expect(
      service.checkForPublish({ ...saved, maxAttempts: 2 }),
    ).rejects.toThrow('幂等');
  });
  it('注销只撤销自身，固定处理器版本缺失时不能回落', () => {
    const registry = new TaskHandlerRegistry();
    const unregister = registry.register(handler);
    registry.register({ ...handler, version: 2 });
    unregister();
    expect(registry.resolve({ key: handler.key, version: 1 })).toBeUndefined();
    expect(registry.resolve({ key: handler.key, version: 2 })).toBeDefined();
  });
});

describe('工作流纯控制状态', () => {
  const edges: WorkflowEdge[] = ['a', 'b'].map((source) => ({
    id: source,
    source,
    sourcePort: 'out',
    target: 'join',
    targetPort: 'in',
  }));
  it('全部汇合必须等待活跃并行分支，未选分支完成跳过后可释放汇合', () => {
    const progress = new Map<string, NodeProgress>([
      ['a', { status: 'succeeded', selectedPorts: ['out'], output: {} }],
      ['b', { status: 'waiting', selectedPorts: [], output: {} }],
    ]);
    expect(nodeReadiness(edges, progress)).toBe('wait');
    progress.set('b', { status: 'skipped', selectedPorts: [], output: {} });
    expect(nodeReadiness(edges, progress)).toBe('ready');
    progress.set('a', { status: 'skipped', selectedPorts: [], output: {} });
    expect(nodeReadiness(edges, progress)).toBe('skip');
  });
  it('规则只激活选中端口，其他路径传递跳过状态', () => {
    const progress = new Map<string, NodeProgress>([
      ['rule', { status: 'succeeded', selectedPorts: ['yes'], output: {} }],
    ]);
    expect(
      nodeReadiness(
        [{ ...edges[0], source: 'rule', sourcePort: 'no' }],
        progress,
      ),
    ).toBe('skip');
    expect(
      nodeReadiness(
        [{ ...edges[0], source: 'rule', sourcePort: 'yes' }],
        progress,
      ),
    ).toBe('ready');
  });
  it('变量只读取成功节点的自身字段，不从原型或未执行路径补值', () => {
    const progress = new Map<string, NodeProgress>([
      [
        'a',
        { status: 'succeeded', selectedPorts: ['out'], output: { amount: 10 } },
      ],
    ]);
    expect(
      bindWorkflowValues(
        { result: { type: 'node', nodeId: 'a', field: 'amount' } },
        {},
        progress,
      ),
    ).toEqual({ result: 10 });
    expect(() =>
      bindWorkflowValues(
        { result: { type: 'node', nodeId: 'missing', field: 'amount' } },
        {},
        progress,
      ),
    ).toThrow('尚未成功');
    expect(
      bindWorkflowValues(
        { result: { type: 'input', field: 'toString' } },
        {},
        progress,
      ),
    ).toEqual({});
  });
});
