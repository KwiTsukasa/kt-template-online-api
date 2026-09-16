import type { WorkflowGraph } from '@/modules/workflow-engine/contract/workflow.types';
import {
  normalizeWorkflowDefinition,
  validateWorkflowGraph,
} from '@/modules/workflow-engine/domain/workflow.policy';
import {
  canReferenceWorkflowNode,
  workflowLoopBody,
} from '@/modules/workflow-engine/domain/workflow-loop.policy';

const edge = (
  source: string,
  target: string,
  sourcePort = 'out',
  targetPort = 'in',
) => ({
  id: `${source}_${target}_${sourcePort}`,
  source,
  target,
  sourcePort,
  targetPort,
});
const graph = (): WorkflowGraph => ({
  schemaVersion: 1,
  timeoutMs: 300000,
  formRef: null,
  formMapping: {},
  inputSchema: { fields: [] },
  outputSchema: { fields: [] },
  output: {},
  nodes: [
    { id: 'start', name: '开始', type: 'start' },
    {
      id: 'loop',
      name: '循环',
      type: 'loop',
      maxIterations: 3,
      condition: null,
    },
    { id: 'first', name: '先执行', type: 'wait', durationMs: 1 },
    { id: 'last', name: '后执行', type: 'wait', durationMs: 1 },
    { id: 'end', name: '结束', type: 'end' },
  ],
  edges: [
    edge('start', 'loop'),
    edge('loop', 'first', 'body'),
    edge('first', 'last'),
    edge('last', 'loop', 'out', 'repeat'),
    edge('loop', 'end', 'done'),
  ],
});

describe('受控循环边界', () => {
  it('允许通过返回端口重复执行，拓扑只忽略受控返回边', () => {
    expect(validateWorkflowGraph(graph())).toEqual({
      valid: true,
      issues: [],
      order: ['start', 'loop', 'first', 'end', 'last'],
    });
    expect([...workflowLoopBody(graph(), 'loop')]).toEqual(['first', 'last']);
  });
  it('拒绝绕过控制器或误接首次入口的回环', () => {
    const input = graph();
    input.edges[3].targetPort = 'in';
    const codes = validateWorkflowGraph(input).issues.map(
      (issue) => issue.code,
    );
    expect(codes).toContain('cycle');
    expect(codes).toContain('loop-entry-cycle');
  });
  it('拒绝从外部进入循环体', () => {
    const input = graph();
    input.edges.push(edge('start', 'last'));
    expect(validateWorkflowGraph(input).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'loop-outside-entry' }),
      ]),
    );
  });
  it('拒绝循环体直接逃逸到流程结束', () => {
    const input = graph();
    input.edges[3] = edge('last', 'end');
    expect(validateWorkflowGraph(input).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'loop-escape' }),
      ]),
    );
  });
  it('允许完整嵌套循环并区分内外循环体', () => {
    const input = graph();
    input.nodes.push({
      id: 'inner',
      name: '内层',
      type: 'loop',
      maxIterations: 2,
      condition: null,
    });
    input.edges = [
      edge('start', 'loop'),
      edge('loop', 'inner', 'body'),
      edge('inner', 'first', 'body'),
      edge('first', 'inner', 'out', 'repeat'),
      edge('inner', 'last', 'done'),
      edge('last', 'loop', 'out', 'repeat'),
      edge('loop', 'end', 'done'),
    ];
    expect(validateWorkflowGraph(input).valid).toBe(true);
    expect(workflowLoopBody(input, 'loop')).toEqual(
      new Set(['inner', 'first', 'last']),
    );
    expect(workflowLoopBody(input, 'inner')).toEqual(new Set(['first']));
  });
  it('当前轮只能读取已在前面执行的节点，条件和循环后可读取本轮结果', () => {
    const input = graph();
    expect(canReferenceWorkflowNode(input, 'first', 'last')).toBe(true);
    expect(canReferenceWorkflowNode(input, 'last', 'first')).toBe(false);
    expect(canReferenceWorkflowNode(input, 'last', 'loop')).toBe(true);
    expect(canReferenceWorkflowNode(input, 'last', 'end')).toBe(true);
    expect(canReferenceWorkflowNode(input, 'last', 'last')).toBe(false);
  });
  it('精确指出脚本参数中的跨轮引用', () => {
    const input = graph();
    input.nodes[2] = {
      id: 'first',
      name: '业务步骤',
      type: 'business',
      stepKey: 'step',
      input: {},
      scripts: [
        {
          key: 'script',
          version: 1,
          sha256: 'a'.repeat(64),
          maxAttempts: 1,
          timeoutMs: 1000,
          retryBackoffMs: 0,
          params: { result: { type: 'node', nodeId: 'last', field: 'value' } },
        },
      ],
    };
    expect(validateWorkflowGraph(input).issues).toContainEqual({
      nodeId: 'first',
      fieldPath: 'scripts.0.params.result',
      code: 'upstream-field',
      message: '变量只能引用上游节点输出',
    });
  });
  it.each([0, 1001, 1.5])('拒绝非法次数上限 %s', (maxIterations) => {
    const input = graph();
    Object.assign(input.nodes[1], { maxIterations });
    expect(() =>
      normalizeWorkflowDefinition({
        graph: input,
        layout: {
          schemaVersion: 1,
          nodes: {},
          edges: {},
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      }),
    ).toThrow();
  });
});
