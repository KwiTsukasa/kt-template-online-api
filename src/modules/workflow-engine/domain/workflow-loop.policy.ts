import type { WorkflowGraph, WorkflowIssue } from '../contract/workflow.types';

export class WorkflowLoopError extends Error {}

/**
 * 判断来源结果能否在当前轮次先于目标使用；经返回边离开循环后只沿结束出口继续。
 * @param graph - 固定执行图。
 * @param source - 提供结果的节点身份。
 * @param target - 接收结果的节点身份。
 * @returns 来源可先于目标完成且不依赖下一轮时返回真。
 */
export function canReferenceWorkflowNode(
  graph: WorkflowGraph,
  source: string,
  target: string,
): boolean {
  if (source === target) return false;
  const visited = new Set<string>();
  const pending = [{ id: source, returning: false }];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.id === target) return true;
    const key = `${current.id}:${current.returning}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const edge of graph.edges) {
      if (edge.source !== current.id) continue;
      if (current.returning && edge.sourcePort !== 'done') continue;
      pending.push({
        id: edge.target,
        returning: edge.targetPort === 'repeat',
      });
    }
  }
  return false;
}

/**
 * 找出循环体范围，控制器的返回边只表示本轮结束，不进入下一轮遍历。
 * @param graph - 固定版本的执行图。
 * @param loopId - 循环控制节点身份。
 * @returns 循环体中的节点身份，包含嵌套循环但不包含自身控制器。
 */
export function workflowLoopBody(
  graph: WorkflowGraph,
  loopId: string,
): Set<string> {
  const body = new Set<string>();
  const pending = graph.edges
    .filter((edge) => edge.source === loopId && edge.sourcePort === 'body')
    .map((edge) => edge.target);
  while (pending.length) {
    const id = pending.pop()!;
    if (id === loopId || body.has(id)) continue;
    body.add(id);
    for (const edge of graph.edges)
      if (edge.source === id && edge.targetPort !== 'repeat')
        pending.push(edge.target);
  }
  return body;
}

/**
 * 限制回环只能经控制节点返回，并检查单入口、封闭循环体及嵌套边界。
 * @param graph - 已通过节点格式解析的执行图。
 * @returns 可定位到循环节点或越界连线的错误。
 */
export function validateWorkflowLoops(graph: WorkflowGraph): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const loops = graph.nodes.filter((node) => node.type === 'loop');
  const bodies = new Map(
    loops.map((node) => [node.id, workflowLoopBody(graph, node.id)]),
  );
  for (const loop of loops) {
    const body = bodies.get(loop.id)!;
    const outputs = graph.edges.filter((edge) => edge.source === loop.id);
    const feedback = graph.edges.filter(
      (edge) => edge.target === loop.id && edge.targetPort === 'repeat',
    );
    if (
      outputs.length !== 2 ||
      outputs.filter((edge) => edge.sourcePort === 'body').length !== 1 ||
      outputs.filter((edge) => edge.sourcePort === 'done').length !== 1 ||
      !body.size ||
      !feedback.length
    )
      issues.push({
        nodeId: loop.id,
        code: 'loop-ports',
        message:
          '循环需要一条循环体出口、一条结束出口，以及循环体返回端口的连线',
      });
    if (
      !graph.edges.some(
        (edge) => edge.target === loop.id && edge.targetPort === 'in',
      )
    )
      issues.push({
        nodeId: loop.id,
        code: 'loop-entry',
        message: '循环控制节点缺少首次进入的连线',
      });
    for (const node of graph.nodes) {
      if (!body.has(node.id)) continue;
      if (node.type === 'start' || node.type === 'end')
        issues.push({
          nodeId: loop.id,
          code: 'loop-escape',
          message: '循环体必须返回循环控制器，不能直接进入开始或结束节点',
        });
    }
    const returning = new Set(feedback.map((edge) => edge.source));
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges)
        if (
          body.has(edge.source) &&
          returning.has(edge.target) &&
          !returning.has(edge.source)
        ) {
          returning.add(edge.source);
          changed = true;
        }
    }
    for (const id of body)
      if (!returning.has(id))
        issues.push({
          nodeId: id,
          code: 'loop-no-return',
          message: '循环体节点必须能回到所属循环的返回端口',
        });
    for (const edge of graph.edges) {
      if (
        body.has(edge.target) &&
        !body.has(edge.source) &&
        !(edge.source === loop.id && edge.sourcePort === 'body')
      )
        issues.push({
          nodeId: loop.id,
          edgeId: edge.id,
          code: 'loop-outside-entry',
          message: '循环体只能从所属控制器进入',
        });
      if (
        edge.target === loop.id &&
        edge.targetPort === 'repeat' &&
        !body.has(edge.source)
      )
        issues.push({
          nodeId: loop.id,
          edgeId: edge.id,
          code: 'loop-outside-return',
          message: '返回端口只能接收本循环体的节点',
        });
      if (
        edge.target === loop.id &&
        edge.targetPort === 'in' &&
        body.has(edge.source)
      )
        issues.push({
          nodeId: loop.id,
          edgeId: edge.id,
          code: 'loop-entry-cycle',
          message: '循环体应连接返回端口，不能重新连接首次入口',
        });
    }
    for (const other of loops) {
      if (other.id === loop.id) continue;
      const otherBody = bodies.get(other.id)!;
      if (body.has(other.id) && [...otherBody].some((id) => !body.has(id)))
        issues.push({
          nodeId: loop.id,
          code: 'loop-overlap',
          message: '嵌套循环体必须完整位于外层循环内',
        });
      if (
        !body.has(other.id) &&
        !otherBody.has(loop.id) &&
        [...body].some((id) => otherBody.has(id))
      )
        issues.push({
          nodeId: loop.id,
          code: 'loop-overlap',
          message: '不同循环不能交叉共用循环体节点',
        });
    }
  }
  return issues;
}
