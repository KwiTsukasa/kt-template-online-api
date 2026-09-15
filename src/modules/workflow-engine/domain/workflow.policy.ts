import { normalizeDataSchema } from '@/common/automation/data-schema';
import {
  definitionRecord,
  publishedReference,
} from '@/common/automation/definition.types';
import type {
  GraphLayout,
  ValueBinding,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowIssue,
  WorkflowNode,
  WorkflowValidation,
} from '../contract/workflow.types';

const identityPattern = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 限制图节点、边与变量字段身份，防止路径和原型名称进入持久映射。
 * @param value - 由编辑器提交的标识。
 * @returns 符合图契约的标识。
 * @throws 身份格式非法时拒绝保存。
 */
function identity(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !identityPattern.test(value) ||
    reserved.has(value)
  )
    throw new Error('节点、边或映射标识不合法');
  return value;
}

/**
 * 将输入映射限制为常量、流程输入或上游节点输出，不执行表达式代码。
 * @param input - 编辑器提交的映射字典。
 * @returns 经过类型检查的变量绑定。
 * @throws 绑定类型、字段标识或常量值非法时拒绝保存。
 */
export function normalizeBindings(
  input: unknown,
): Record<string, ValueBinding> {
  const source = definitionRecord(input);
  if (Object.keys(source).length > 64) throw new Error('变量映射最多 64 项');
  const result: Record<string, ValueBinding> = {};
  for (const [field, raw] of Object.entries(source)) {
    identity(field);
    const binding = definitionRecord(raw);
    if (binding.type === 'literal') {
      const value = binding.value;
      if (
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 16384) ||
        (typeof value === 'number' && Number.isFinite(value))
      )
        result[field] = { type: 'literal', value };
      else throw new Error('映射常量必须是有界标量');
    } else if (binding.type === 'input')
      result[field] = { type: 'input', field: identity(binding.field) };
    else if (binding.type === 'node')
      result[field] = {
        type: 'node',
        nodeId: identity(binding.nodeId),
        field: identity(binding.field),
      };
    else throw new Error('变量只支持常量、流程输入或节点输出');
  }
  return result;
}

/**
 * 规范化节点自身配置，外部任务、规则和表单始终使用固定发布版本引用。
 * @param input - 单个节点的领域数据。
 * @returns 去除图引擎展示字段后的执行节点。
 * @throws 节点类别、引用或等待时间非法时拒绝保存。
 */
function normalizeNode(input: unknown): WorkflowNode {
  const node = definitionRecord(input);
  const id = identity(node.id);
  if (
    typeof node.name !== 'string' ||
    !node.name.trim() ||
    node.name.length > 128
  )
    throw new Error('节点名称需要 1 至 128 个字符');
  const base = { id, name: node.name.trim() };
  if (node.type === 'start' || node.type === 'end')
    return { ...base, type: node.type };
  if (node.type === 'task')
    return {
      ...base,
      type: 'task',
      taskRef: publishedReference(node.taskRef),
      input: normalizeBindings(node.input),
    };
  if (node.type === 'rule') {
    if (
      !Array.isArray(node.branches) ||
      !node.branches.length ||
      node.branches.length > 65
    )
      throw new Error('规则节点需要 1 至 65 个结果分支');
    const ports = new Set<string>();
    const values = new Set<string>();
    const branches = node.branches.map((raw) => {
      const branch = definitionRecord(raw);
      const port = identity(branch.port);
      const value = branch.value;
      if (
        value !== null &&
        typeof value !== 'boolean' &&
        !(typeof value === 'number' && Number.isFinite(value)) &&
        !(typeof value === 'string' && value.length <= 2048)
      )
        throw new Error('规则分支只支持有界标量');
      const key = JSON.stringify(value);
      if (ports.has(port) || values.has(key))
        throw new Error('规则分支端口与结果不能重复');
      ports.add(port);
      values.add(key);
      return { port, value: value as boolean | null | number | string };
    });
    return {
      ...base,
      type: 'rule',
      ruleRef: publishedReference(node.ruleRef),
      facts: normalizeBindings(node.facts),
      branches,
    };
  }
  if (node.type === 'fork')
    return { ...base, type: 'fork', joinId: identity(node.joinId) };
  if (node.type === 'join')
    return { ...base, type: 'join', forkId: identity(node.forkId) };
  if (node.type === 'wait') {
    if (
      !Number.isSafeInteger(node.durationMs) ||
      Number(node.durationMs) < 1000 ||
      Number(node.durationMs) > 30 * 86400000
    )
      throw new Error('等待时间需要 1 秒至 30 天');
    return { ...base, type: 'wait', durationMs: Number(node.durationMs) };
  }
  throw new Error('流程节点类型不支持');
}

/**
 * 检查展示坐标的数值边界，避免无穷坐标和超大路径进入画布。
 * @param input - 编辑器保存的二维坐标。
 * @returns 有界坐标。
 * @throws 坐标不是有限数值或超出范围时拒绝保存。
 */
function point(input: unknown): { x: number; y: number } {
  const value = definitionRecord(input);
  if (
    typeof value.x !== 'number' ||
    typeof value.y !== 'number'
  )
    throw new Error('图布局坐标不合法');
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    Math.abs(value.x) > 100000 ||
    Math.abs(value.y) > 100000
  )
    throw new Error('图布局坐标不合法');
  return { x: value.x, y: value.y };
}

/**
 * 分别解析执行图和展示布局；保存可以保留拓扑未完成的草稿，发布前另做完整图校验。
 * @param input - 工作流定义与独立布局。
 * @returns 规范化的领域图和可恢复画布布局。
 * @throws 格式、节点配置、版本引用或布局边界非法时拒绝保存。
 */
export function normalizeWorkflowDefinition(
  input: unknown,
): WorkflowDefinition {
  const source = definitionRecord(input);
  const raw = definitionRecord(source.graph);
  if (
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.nodes) ||
    !Array.isArray(raw.edges)
  )
    throw new Error('工作流结构版本或图规模不支持');
  if (
    raw.nodes.length < 2 ||
    raw.nodes.length > 128 ||
    raw.edges.length > 256
  )
    throw new Error('工作流结构版本或图规模不支持');
  const nodes = raw.nodes.map(normalizeNode);
  const edges: WorkflowEdge[] = raw.edges.map((value) => {
    const edge = definitionRecord(value);
    return {
      id: identity(edge.id),
      source: identity(edge.source),
      target: identity(edge.target),
      sourcePort: identity(edge.sourcePort),
      targetPort: identity(edge.targetPort),
    };
  });
  if (
    new Set(nodes.map((node) => node.id)).size !== nodes.length ||
    new Set(edges.map((edge) => edge.id)).size !== edges.length
  )
    throw new Error('图节点或边标识重复');
  if (
    !Number.isSafeInteger(raw.timeoutMs) ||
    Number(raw.timeoutMs) < 1000 ||
    Number(raw.timeoutMs) > 31 * 86400000
  )
    throw new Error('流程期限需要 1 秒至 31 天');
  const formMapping: Record<string, string> = {};
  for (const [target, field] of Object.entries(
    definitionRecord(raw.formMapping),
  ))
    formMapping[identity(target)] = identity(field);
  let formRef = null;
  if (raw.formRef !== null && raw.formRef !== undefined)
    formRef = publishedReference(raw.formRef);
  const graph: WorkflowGraph = {
    schemaVersion: 1,
    nodes,
    edges,
    inputSchema: normalizeDataSchema(raw.inputSchema),
    outputSchema: normalizeDataSchema(raw.outputSchema),
    output: normalizeBindings(raw.output),
    formRef,
    formMapping,
    timeoutMs: Number(raw.timeoutMs),
  };
  const display = definitionRecord(source.layout);
  if (display.schemaVersion !== 1) throw new Error('图布局版本不支持');
  const viewport = definitionRecord(display.viewport);
  if (
    typeof viewport.zoom !== 'number' ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom < 0.1 ||
    viewport.zoom > 4
  )
    throw new Error('画布缩放超出范围');
  const layout: GraphLayout = {
    schemaVersion: 1,
    nodes: {},
    edges: {},
    viewport: { ...point(viewport), zoom: viewport.zoom },
  };
  const positions = definitionRecord(display.nodes);
  const routes = definitionRecord(display.edges);
  for (const node of nodes)
    if (positions[node.id] !== undefined)
      layout.nodes[node.id] = point(positions[node.id]);
  for (const edge of edges) {
    if (routes[edge.id] === undefined) continue;
    const route = definitionRecord(routes[edge.id]);
    if (!Array.isArray(route.vertices) || route.vertices.length > 64)
      throw new Error('连线路径最多 64 个拐点');
    layout.edges[edge.id] = { vertices: route.vertices.map(point) };
  }
  return { graph, layout };
}

/**
 * 验证有向无环图、端口、开始结束、可达性和并行配对，返回可定位到图元素的错误。
 * @param graph - 经过格式规范化的执行图。
 * @returns 完整错误清单与确定的拓扑顺序。
 */
export function validateWorkflowGraph(
  graph: WorkflowGraph,
): WorkflowValidation {
  const issues: WorkflowIssue[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(
    graph.nodes.map((node) => [node.id, [] as WorkflowEdge[]]),
  );
  const outgoing = new Map(
    graph.nodes.map((node) => [node.id, [] as WorkflowEdge[]]),
  );
  const starts = graph.nodes.filter((node) => node.type === 'start');
  const ends = graph.nodes.filter((node) => node.type === 'end');
  if (starts.length !== 1)
    issues.push({
      code: 'start-count',
      message: '流程必须且只能有一个开始节点',
    });
  if (ends.length !== 1)
    issues.push({ code: 'end-count', message: '流程必须且只能有一个结束节点' });
  const endpoints = new Set<string>();
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      issues.push({
        edgeId: edge.id,
        code: 'missing-node',
        message: '连线引用了不存在的节点',
      });
      continue;
    }
    incoming.get(target.id)!.push(edge);
    outgoing.get(source.id)!.push(edge);
    const key = `${edge.source}:${edge.sourcePort}:${edge.target}:${edge.targetPort}`;
    if (endpoints.has(key))
      issues.push({
        edgeId: edge.id,
        code: 'duplicate-edge',
        message: '节点之间有重复连线',
      });
    endpoints.add(key);
    if (source.id === target.id)
      issues.push({
        edgeId: edge.id,
        code: 'self-loop',
        message: '节点不能连接自身',
      });
    let validSource = edge.sourcePort === 'out';
    if (source.type === 'rule')
      validSource = source.branches.some(
        (branch) => branch.port === edge.sourcePort,
      );
    if (
      source.type === 'end' ||
      target.type === 'start' ||
      edge.targetPort !== 'in' ||
      !validSource
    )
      issues.push({
        edgeId: edge.id,
        code: 'port',
        message: '连线端口不符合节点契约',
      });
  }
  const indegree = new Map(
    graph.nodes.map((node) => [node.id, incoming.get(node.id)!.length]),
  );
  const queue = graph.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const edge of outgoing.get(id)!) {
      indegree.set(edge.target, indegree.get(edge.target)! - 1);
      if (indegree.get(edge.target) === 0) queue.push(edge.target);
    }
  }
  if (order.length !== graph.nodes.length)
    issues.push({
      code: 'cycle',
      message: '流程存在循环，当前只支持有向无环图',
    });
  const reachable = (from: string, stop?: string): Set<string> => {
    const seen = new Set<string>();
    const pending = [from];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (id === stop) continue;
      for (const edge of outgoing.get(id) || []) pending.push(edge.target);
    }
    return seen;
  };
  const accessible = new Set<string>();
  if (starts[0]) for (const id of reachable(starts[0].id)) accessible.add(id);
  for (const node of graph.nodes) {
    const inputs = incoming.get(node.id)!;
    const outputs = outgoing.get(node.id)!;
    if (!accessible.has(node.id))
      issues.push({
        nodeId: node.id,
        code: 'orphan',
        message: '节点无法从开始节点到达',
      });
    if (node.type !== 'end' && ends[0] && !reachable(node.id).has(ends[0].id))
      issues.push({
        nodeId: node.id,
        code: 'no-end',
        message: '节点无法到达结束节点',
      });
    if (node.type === 'start' && inputs.length)
      issues.push({
        nodeId: node.id,
        code: 'start-input',
        message: '开始节点不能有输入连线',
      });
    if (node.type !== 'start' && !inputs.length)
      issues.push({
        nodeId: node.id,
        code: 'missing-input',
        message: '节点缺少输入连线',
      });
    if (node.type === 'end') {
      if (outputs.length)
        issues.push({
          nodeId: node.id,
          code: 'end-output',
          message: '结束节点不能有输出连线',
        });
    } else if (node.type === 'fork') {
      const join = nodes.get(node.joinId);
      if (
        join?.type !== 'join' ||
        join.forkId !== node.id ||
        outputs.length < 2
      )
        issues.push({
          nodeId: node.id,
          code: 'fork-pair',
          message: '并行分支需要至少两条分支和对应的全部汇合节点',
        });
      for (const edge of outputs) {
        const branch = reachable(edge.target, node.joinId);
        if (!branch.has(node.joinId) || (ends[0] && branch.has(ends[0].id)))
          issues.push({
            nodeId: node.id,
            edgeId: edge.id,
            code: 'fork-escape',
            message: '每条并行分支必须先到达配对汇合节点',
          });
      }
      const branches = outputs.map((edge) =>
        reachable(edge.target, node.joinId),
      );
      const branchNodes = new Set([node.id, ...branches.flatMap((branch) => [...branch])]);
      for (const edge of incoming.get(node.joinId) || []) {
        if (!branchNodes.has(edge.source)) issues.push({ nodeId: node.joinId, edgeId: edge.id, code: 'join-outside-input', message: '汇合节点不能接收配对并行范围之外的路径' });
      }
      for (let index = 0; index < branches.length; index += 1) {
        for (let other = index + 1; other < branches.length; other += 1) {
          if (
            [...branches[index]].some(
              (id) => id !== node.joinId && branches[other].has(id),
            )
          )
            issues.push({
              nodeId: node.id,
              code: 'fork-overlap',
              message: '并行分支不能在配对汇合前共用执行节点',
            });
        }
      }
    } else if (node.type === 'rule') {
      if (
        outputs.length !== node.branches.length ||
        node.branches.some(
          (branch) =>
            outputs.filter((edge) => edge.sourcePort === branch.port).length !==
            1,
        )
      )
        issues.push({
          nodeId: node.id,
          code: 'rule-branches',
          message: '规则的每个结果分支必须连接一个后继节点',
        });
    } else if (outputs.length !== 1)
      issues.push({
        nodeId: node.id,
        code: 'output-count',
        message: '该节点必须连接一个后继节点',
      });
    if (node.type === 'join') {
      const fork = nodes.get(node.forkId);
      if (fork?.type !== 'fork' || fork.joinId !== node.id || inputs.length < 2)
        issues.push({
          nodeId: node.id,
          code: 'join-pair',
          message: '汇合节点需要配对的并行分支及至少两个输入',
        });
    }
    let bindings: Record<string, ValueBinding> = {};
    if (node.type === 'task') bindings = node.input;
    if (node.type === 'rule') bindings = node.facts;
    for (const [field, binding] of Object.entries(bindings)) {
      if (
        binding.type === 'input' &&
        !graph.inputSchema.fields.some((input) => input.key === binding.field)
      )
        issues.push({
          nodeId: node.id,
          fieldPath: field,
          code: 'input-field',
          message: '映射引用了未声明的流程输入',
        });
      if (
        binding.type === 'node' &&
        (binding.nodeId === node.id ||
          !nodes.has(binding.nodeId) ||
          !reachable(binding.nodeId).has(node.id))
      )
        issues.push({
          nodeId: node.id,
          fieldPath: field,
          code: 'upstream-field',
          message: '变量只能引用上游节点输出',
        });
    }
  }
  return { valid: issues.length === 0, issues, order };
}
