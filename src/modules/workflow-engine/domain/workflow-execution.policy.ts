import type { ValueBinding, WorkflowEdge } from '../contract/workflow.types';
import type { WorkflowNodeStatus } from '../contract/workflow-run.types';

export type NodeProgress = {
  activePorts?: string[];
  status: WorkflowNodeStatus;
  selectedPorts: string[];
  output: Record<string, unknown>;
};

/**
 * 等待全部前驱完成决策后判断节点是否激活，未选中的规则路径不会误入并行汇合。
 * @param incoming - 当前节点的输入连线。
 * @param progress - 已持久化的各节点状态与选中端口。
 * @returns 尚需等待、可以执行或整条路径未激活。
 */
export function nodeReadiness(
  incoming: WorkflowEdge[],
  progress: Map<string, NodeProgress>,
): 'wait' | 'ready' | 'skip' {
  if (!incoming.length) return 'ready';
  for (const edge of incoming) {
    const source = progress.get(edge.source);
    if (
      source?.status === 'waiting' &&
      source.activePorts?.includes(edge.sourcePort)
    )
      continue;
    if (!source || ['pending', 'waiting'].includes(source.status))
      return 'wait';
  }
  if (
    incoming.some((edge) => {
      const source = progress.get(edge.source)!;
      return (
        (source.status === 'succeeded' &&
          source.selectedPorts.includes(edge.sourcePort)) ||
        (source.status === 'waiting' &&
          Boolean(source.activePorts?.includes(edge.sourcePort)))
      );
    })
  )
    return 'ready';
  return 'skip';
}

/**
 * 从已持久字段或当前活动的循环序号建立参数，优先取值跳过未产生的结果并保留零和假。
 * @param bindings - 当前节点或流程输出的字段映射。
 * @param input - 已校验的流程输入。
 * @param progress - 当前持久节点输出。
 * @param iterationIndex - BPMN 当前活动从零开始的循环索引，非循环活动不提供。
 * @returns 不包含原型或未声明动态执行内容的参数对象。
 * @throws 直接引用尚未成功的节点，或在非循环活动读取序号时拒绝执行。
 */
export function bindWorkflowValues(
  bindings: Record<string, ValueBinding>,
  input: Record<string, unknown>,
  progress: Map<string, NodeProgress>,
  iterationIndex?: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.type === 'literal') result[key] = binding.value;
    else if (binding.type === 'iteration') {
      if (!Number.isSafeInteger(iterationIndex) || iterationIndex < 0)
        throw new Error('当前活动没有可读取的循环序号');
      result[key] = iterationIndex + 1;
    } else if (binding.type === 'first') {
      for (const source of binding.sources) {
        let values: Record<string, unknown> | undefined;
        if (source.type === 'input') values = input;
        else {
          const node = progress.get(source.nodeId);
          if (node?.status === 'succeeded') values = node.output;
        }
        if (values && Object.hasOwn(values, source.field) && values[source.field] !== null && values[source.field] !== undefined) {
          result[key] = values[source.field];
          break;
        }
      }
    }
    else if (binding.type === 'input') {
      if (Object.hasOwn(input, binding.field))
        result[key] = input[binding.field];
    } else {
      const source = progress.get(binding.nodeId);
      if (!source || source.status !== 'succeeded')
        throw new Error('映射来源节点尚未成功');
      if (Object.hasOwn(source.output, binding.field))
        result[key] = source.output[binding.field];
    }
  }
  return result;
}
