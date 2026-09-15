import { normalizeWorkflowDefinition, validateWorkflowGraph } from '@/modules/workflow-engine/domain/workflow.policy';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '@/modules/workflow-engine/contract/workflow.types';

const edge = (source: string, target: string, sourcePort = 'out'): WorkflowEdge => ({ id: `${source}_${target}_${sourcePort}`, source, target, sourcePort, targetPort: 'in' });
const definition = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition => ({
  graph: { schemaVersion: 1, nodes, edges, inputSchema: { fields: [] }, outputSchema: { fields: [] }, output: {}, formRef: null, formMapping: {}, timeoutMs: 300000 },
  layout: { schemaVersion: 1, nodes: {}, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } },
});
const start: WorkflowNode = { id: 'start', name: '开始', type: 'start' };
const end: WorkflowNode = { id: 'end', name: '结束', type: 'end' };
const wait: WorkflowNode = { id: 'wait', name: '等待', type: 'wait', durationMs: 1000 };

describe('workflow domain graph validation', () => {
  it('keeps engine-specific cells out of execution definitions and preserves layout independently', () => {
    const input = definition([start, wait, end], [edge('start', 'wait'), edge('wait', 'end')]);
    input.layout.nodes.wait = { x: 120, y: 250 };
    const normalized = normalizeWorkflowDefinition({ ...input, cells: [{ shape: 'script' }] });
    expect(normalized.layout.nodes.wait).toEqual({ x: 120, y: 250 });
    expect(normalized).not.toHaveProperty('cells');
    expect(validateWorkflowGraph(normalized.graph)).toEqual({ valid: true, issues: [], order: ['start', 'wait', 'end'] });
  });

  it('identifies cyclic edges and unreachable end without executing anything', () => {
    const input = definition([start, wait, end], [edge('start', 'wait'), edge('wait', 'start')]);
    const validation = validateWorkflowGraph(input.graph);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.code === 'cycle')).toBe(true);
    expect(validation.issues.some((issue) => issue.nodeId === 'wait' && issue.code === 'no-end')).toBe(true);
  });

  it('requires each rule result to have exactly one typed output edge', () => {
    const rule: WorkflowNode = { id: 'rule', name: '条件', type: 'rule', ruleRef: { id: '123', version: 1 }, facts: {}, branches: [{ port: 'matched', value: true }, { port: 'unmatched', value: false }] };
    const complete = definition([start, rule, end], [edge('start', 'rule'), edge('rule', 'end', 'matched'), edge('rule', 'end', 'unmatched')]);
    expect(validateWorkflowGraph(complete.graph).valid).toBe(true);
    complete.graph.edges.pop();
    expect(validateWorkflowGraph(complete.graph).issues.some((issue) => issue.code === 'rule-branches')).toBe(true);
  });

  it('accepts paired parallel branches and rejects merging before the owned join', () => {
    const fork: WorkflowNode = { id: 'fork', name: '并行', type: 'fork', joinId: 'join' };
    const join: WorkflowNode = { id: 'join', name: '汇合', type: 'join', forkId: 'fork' };
    const other: WorkflowNode = { ...wait, id: 'other' };
    const input = definition([start, fork, wait, other, join, end], [edge('start', 'fork'), edge('fork', 'wait'), edge('fork', 'other'), edge('wait', 'join'), edge('other', 'join'), edge('join', 'end')]);
    expect(validateWorkflowGraph(input.graph).valid).toBe(true);
    input.graph.edges = input.graph.edges.filter((item) => item.source !== 'other');
    input.graph.edges.push(edge('other', 'wait'));
    expect(validateWorkflowGraph(input.graph).issues.some((issue) => issue.code === 'fork-overlap')).toBe(true);
  });

  it('rejects a fork branch that escapes directly to the end', () => {
    const fork: WorkflowNode = { id: 'fork', name: '并行', type: 'fork', joinId: 'join' };
    const join: WorkflowNode = { id: 'join', name: '汇合', type: 'join', forkId: 'fork' };
    const input = definition([start, fork, wait, join, end], [edge('start', 'fork'), edge('fork', 'wait'), edge('fork', 'end'), edge('wait', 'join'), edge('join', 'end')]);
    expect(validateWorkflowGraph(input.graph).issues.some((issue) => issue.code === 'fork-escape')).toBe(true);
  });

  it('rejects an outside conditional path activating a join whose fork did not run', () => {
    const rule: WorkflowNode = { id: 'rule', name: '入口分支', type: 'rule', ruleRef: { id: '123', version: 1 }, facts: {}, branches: [{ port: 'yes', value: true }, { port: 'no', value: false }] };
    const fork: WorkflowNode = { id: 'fork', name: '并行', type: 'fork', joinId: 'join' };
    const join: WorkflowNode = { id: 'join', name: '汇合', type: 'join', forkId: 'fork' };
    const other: WorkflowNode = { ...wait, id: 'other' };
    const input = definition([start, rule, fork, wait, other, join, end], [edge('start', 'rule'), edge('rule', 'fork', 'yes'), edge('rule', 'join', 'no'), edge('fork', 'wait'), edge('fork', 'other'), edge('wait', 'join'), edge('other', 'join'), edge('join', 'end')]);
    expect(validateWorkflowGraph(input.graph).issues.some((issue) => issue.code === 'join-outside-input')).toBe(true);
  });

  it('rejects downstream data references with the exact receiving node and field', () => {
    const task: WorkflowNode = { id: 'task', name: '原子任务', type: 'task', taskRef: { id: '123', version: 1 }, input: { amount: { type: 'node', nodeId: 'wait', field: 'amount' } } };
    const input = definition([start, task, wait, end], [edge('start', 'task'), edge('task', 'wait'), edge('wait', 'end')]);
    expect(validateWorkflowGraph(input.graph).issues).toContainEqual({ nodeId: 'task', fieldPath: 'amount', code: 'upstream-field', message: '变量只能引用上游节点输出' });
  });

  it('rejects nonfinite layout coordinates and duplicate decision results', () => {
    const input = definition([start, end], [edge('start', 'end')]);
    input.layout.nodes.start = { x: Number.NaN, y: 0 };
    expect(() => normalizeWorkflowDefinition(input)).toThrow('坐标');
    const rule = { id: 'rule', name: '重复分支', type: 'rule', ruleRef: { id: '123', version: 1 }, facts: {}, branches: [{ port: 'first', value: true }, { port: 'second', value: true }] };
    expect(() => normalizeWorkflowDefinition({ ...input, graph: { ...input.graph, nodes: [start, rule, end] } })).toThrow('不能重复');
  });
});
