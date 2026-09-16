import { normalizeDataSchema } from '@/common/automation/data-schema';
import { normalizeWorkflowScripts } from './workflow-script.policy';
import {
  canReferenceWorkflowNode,
  validateWorkflowLoops,
} from './workflow-loop.policy';
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
  WorkflowNodeLayout,
  WorkflowPortSide,
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
 * 限制字段映射、循环序号及有界候选来源，禁止嵌套取值链或执行表达式代码。
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
    } else if (binding.type === 'iteration') result[field] = { type: 'iteration' };
    else if (binding.type === 'first') {
      if (!Array.isArray(binding.sources) || binding.sources.length < 1 || binding.sources.length > 8)
        throw new Error('优先取值需要 1 至 8 个字段来源');
      const sources = binding.sources.map((rawSource) => {
        const candidate = definitionRecord(rawSource);
        if (candidate.type === 'input') return { type: 'input' as const, field: identity(candidate.field) };
        if (candidate.type === 'node') return { type: 'node' as const, nodeId: identity(candidate.nodeId), field: identity(candidate.field) };
        throw new Error('优先取值只能引用流程输入或节点输出');
      });
      result[field] = { type: 'first', sources };
    } else if (binding.type === 'input')
      result[field] = { type: 'input', field: identity(binding.field) };
    else if (binding.type === 'node')
      result[field] = {
        type: 'node',
        nodeId: identity(binding.nodeId),
        field: identity(binding.field),
      };
    else throw new Error('变量映射类型不支持');
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
  if (node.type === 'start') return { ...base, type: 'start' };
  if (node.type === 'end') {
    let outcome = node.outcome;
    if (outcome === undefined) outcome = 'succeeded';
    if (
      outcome !== 'succeeded' &&
      outcome !== 'failed' &&
      outcome !== 'cancelled'
    )
      throw new Error('结束状态只支持成功、失败或取消');
    return { ...base, type: 'end', outcome };
  }
  if (node.type === 'task')
    return {
      ...base,
      type: 'task',
      taskRef: publishedReference(node.taskRef),
      input: normalizeBindings(node.input),
    };
  if (node.type === 'business') {
    if (
      typeof node.stepKey !== 'string' ||
      !/^[a-z][a-z0-9.-]{1,63}$/.test(node.stepKey)
    )
      throw new Error('业务步骤标识不合法');
    return {
      ...base,
      type: 'business',
      stepKey: node.stepKey,
      scripts: normalizeWorkflowScripts(node.scripts),
      input: normalizeBindings(node.input),
    };
  }
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
  if (node.type === 'loop') {
    if (
      !Number.isSafeInteger(node.maxIterations) ||
      Number(node.maxIterations) < 1 ||
      Number(node.maxIterations) > 1000
    )
      throw new Error('循环次数上限需要 1 至 1000');
    let condition = null;
    if (node.condition !== null && node.condition !== undefined) {
      const value = definitionRecord(node.condition);
      if (typeof value.continueOn !== 'boolean')
        throw new Error('循环继续条件必须是布尔值');
      condition = {
        ruleRef: publishedReference(value.ruleRef),
        facts: normalizeBindings(value.facts),
        continueOn: value.continueOn,
      };
    }
    return {
      ...base,
      type: 'loop',
      maxIterations: Number(node.maxIterations),
      condition,
    };
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
  if (typeof value.x !== 'number' || typeof value.y !== 'number')
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
 * 保留节点形态与端口朝向，并限制尺寸以保证重载后的节点仍可操作。
 * @param input - 节点独立于执行数据的展示配置。
 * @returns 合法坐标、尺寸、形态与端口方向。
 * @throws 尺寸或展示枚举不合法时拒绝保存。
 */
function nodeLayout(input: unknown): WorkflowNodeLayout {
  const value = definitionRecord(input);
  const result: WorkflowNodeLayout = point(value);
  for (const dimension of ['width', 'height'] as const) {
    const size = value[dimension];
    if (size === undefined) continue;
    let minimum = 64;
    if (dimension === 'width') minimum = 120;
    if (
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < minimum ||
      size > 600
    )
      throw new Error('节点宽度需要 120 至 600，高度需要 64 至 600');
    result[dimension] = size;
  }
  if (value.shape !== undefined) {
    if (
      !['rounded', 'rectangle', 'capsule', 'diamond'].includes(
        String(value.shape),
      )
    )
      throw new Error('节点形态不支持');
    result.shape = value.shape as WorkflowNodeLayout['shape'];
  }
  for (const side of ['inputSide', 'outputSide'] as const) {
    if (value[side] === undefined) continue;
    if (!['left', 'right', 'top', 'bottom'].includes(String(value[side])))
      throw new Error('节点端口方向不支持');
    result[side] = value[side] as WorkflowPortSide;
  }
  return result;
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
  if (raw.nodes.length < 2 || raw.nodes.length > 128 || raw.edges.length > 256)
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
  if (raw.processRef !== undefined && raw.processRef !== null) {
    const processRef = definitionRecord(raw.processRef);
    if (
      typeof processRef.key !== 'string' ||
      !/^[a-z][a-z0-9.-]{2,63}$/.test(processRef.key) ||
      !Number.isSafeInteger(processRef.version) ||
      Number(processRef.version) < 1
    )
      throw new Error('业务流程接口引用不合法');
    graph.processRef = {
      key: processRef.key,
      version: Number(processRef.version),
    };
  }
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
  if (display.direction !== undefined) {
    if (display.direction !== 'horizontal' && display.direction !== 'vertical')
      throw new Error('流程布局方向不支持');
    layout.direction = display.direction;
  }
  const routes = definitionRecord(display.edges);
  for (const node of nodes)
    if (positions[node.id] !== undefined)
      layout.nodes[node.id] = nodeLayout(positions[node.id]);
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
 * 验证受控回环之外的拓扑、端口、可达性和并行配对，返回可定位到图元素的错误。
 * @param graph - 经过格式规范化的执行图。
 * @returns 完整错误清单与确定的拓扑顺序。
 */
export function validateWorkflowGraph(
  graph: WorkflowGraph,
): WorkflowValidation {
  const issues: WorkflowIssue[] = validateWorkflowLoops(graph);
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
  if (!ends.length)
    issues.push({ code: 'end-count', message: '流程必须至少有一个结束节点' });
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
    if (source.type === 'loop')
      validSource = ['body', 'done'].includes(edge.sourcePort);
    if (source.type === 'rule')
      validSource = source.branches.some(
        (branch) => branch.port === edge.sourcePort,
      );
    if (
      source.type === 'end' ||
      target.type === 'start' ||
      !(
        edge.targetPort === 'in' ||
        (target.type === 'loop' && edge.targetPort === 'repeat')
      ) ||
      !validSource
    )
      issues.push({
        edgeId: edge.id,
        code: 'port',
        message: '连线端口不符合节点契约',
      });
  }
  const indegree = new Map(
    graph.nodes.map((node) => [
      node.id,
      incoming.get(node.id)!.filter((edge) => edge.targetPort !== 'repeat')
        .length,
    ]),
  );
  const queue = graph.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const edge of outgoing.get(id)!) {
      if (edge.targetPort === 'repeat') continue;
      indegree.set(edge.target, indegree.get(edge.target)! - 1);
      if (indegree.get(edge.target) === 0) queue.push(edge.target);
    }
  }
  if (order.length !== graph.nodes.length)
    issues.push({
      code: 'cycle',
      message: '回环必须经过循环节点的返回端口，不能形成无控制器的循环',
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
    if (
      node.type !== 'end' &&
      !ends.some((end) => reachable(node.id).has(end.id))
    )
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
        if (!branch.has(node.joinId) || ends.some((end) => branch.has(end.id)))
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
      const branchNodes = new Set([
        node.id,
        ...branches.flatMap((branch) => [...branch]),
      ]);
      for (const edge of incoming.get(node.joinId) || []) {
        if (!branchNodes.has(edge.source))
          issues.push({
            nodeId: node.joinId,
            edgeId: edge.id,
            code: 'join-outside-input',
            message: '汇合节点不能接收配对并行范围之外的路径',
          });
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
    } else if (node.type !== 'loop' && outputs.length !== 1)
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
    if (node.type === 'task' || node.type === 'business') bindings = node.input;
    if (node.type === 'rule') bindings = node.facts;
    if (node.type === 'loop' && node.condition) bindings = node.condition.facts;
    const allBindings = Object.entries(bindings);
    if (node.type === 'business')
      node.scripts.forEach((script, index) => {
        for (const [field, binding] of Object.entries(script.params))
          allBindings.push([`scripts.${index}.params.${field}`, binding]);
      });
    for (const [field, binding] of allBindings) {
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
          !canReferenceWorkflowNode(graph, binding.nodeId, node.id))
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
