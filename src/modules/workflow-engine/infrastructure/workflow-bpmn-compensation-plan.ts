import {
  COMPENSATION_ORDER_PASSES,
  COMPENSATION_ORDER_RADIX,
} from '../constants/compensation';
import {
  WorkflowBpmnFlowIndex,
  type WorkflowSequenceFlow,
} from './workflow-bpmn-flow-index';

export interface CompensationTarget<T> {
  id: string;
  activityId: string;
  sequential: boolean;
  records: T[];
}
export interface CompensationDispatch<T> {
  target: CompensationTarget<T>;
  record: T;
}

/**
 * 稳定排列非负安全整数完成序号，固定七轮字节计数保持 O(R)，同序保留目标及队列原顺序。
 * @param entries - 本次补偿拥有的全部收据。
 * @param order - 读取收据完成序号，历史缺失值由调用方归零。
 * @returns 按完成序号升序排列的收据引用，不复制业务内容。
 */
function orderReceipts<T>(
  entries: CompensationDispatch<T>[],
  order: (record: T) => number,
): CompensationDispatch<T>[] {
  let source = entries.map((entry) => ({ entry, order: order(entry.record) }));
  for (
    let pass = 0, divisor = 1;
    pass < COMPENSATION_ORDER_PASSES;
    pass++, divisor *= COMPENSATION_ORDER_RADIX
  ) {
    const counts = new Uint32Array(COMPENSATION_ORDER_RADIX);
    for (const item of source)
      counts[Math.floor(item.order / divisor) % COMPENSATION_ORDER_RADIX]++;
    let offset = 0;
    for (let digit = 0; digit < counts.length; digit++) {
      const size = counts[digit];
      counts[digit] = offset;
      offset += size;
    }
    const target = new Array<(typeof source)[number]>(source.length);
    for (const item of source)
      target[
        counts[Math.floor(item.order / divisor) % COMPENSATION_ORDER_RADIX]++
      ] = item;
    source = target;
  }
  return source.map((item) => item.entry);
}

export class WorkflowCompensationPlan<T> {
  private readonly graph;
  private readonly targetsByComponent = new Map<
    number,
    Map<string, CompensationTarget<T>>
  >();
  private readonly receiptsByComponent = new Map<
    number,
    CompensationDispatch<T>[]
  >();
  private readonly unresolvedSuccessors: number[];
  private readonly remaining = new Set<string>();
  private readonly ready = new Set<number>();
  private readonly inFlight = new Set<number>();

  constructor(
    flows: readonly WorkflowSequenceFlow[],
    targets: CompensationTarget<T>[],
    order: (record: T) => number,
  ) {
    this.graph = new WorkflowBpmnFlowIndex(flows).condense(
      targets.map((target) => target.activityId),
    );
    this.unresolvedSuccessors = this.graph.components.map(
      (component) => component.successors.size,
    );
    const entries: CompensationDispatch<T>[] = [];
    for (const target of targets) {
      if (!target.records.length) continue;
      const id = this.graph.componentByNode.get(target.activityId)!;
      const group = this.targetsByComponent.get(id) ?? new Map();
      group.set(target.id, target);
      this.targetsByComponent.set(id, group);
      this.remaining.add(target.id);
      for (const record of target.records) entries.push({ target, record });
      target.records.length = 0;
    }
    for (const entry of orderReceipts(entries, order)) {
      const id = this.graph.componentByNode.get(entry.target.activityId)!;
      entry.target.records.push(entry.record);
      if (!this.graph.components[id].cyclic) continue;
      const receipts = this.receiptsByComponent.get(id) ?? [];
      receipts.push(entry);
      this.receiptsByComponent.set(id, receipts);
    }
    this.activate(
      this.graph.components.flatMap((_component, id) => {
        if (this.unresolvedSuccessors[id] === 0) return [id];
        return [];
      }),
    );
  }

  /**
   * 提供尚未派发的目标身份，持久快照不需要重新扫描所有活动或队列。
   * @returns 剩余目标身份集合，只允许调用方读取。
   */
  remainingTargets(): ReadonlySet<string> {
    return this.remaining;
  }

  /**
   * 上一批处理器完成后释放直接前驱；循环分量按完成逆序派发，独立分量可在同批并行。
   * @returns 本轮需要启动的目标与收据；每份收据在整个计划中只取出一次。
   */
  take(): CompensationDispatch<T>[] {
    this.activate([...this.inFlight]);
    this.inFlight.clear();
    const result: CompensationDispatch<T>[] = [];
    for (const id of this.ready) {
      const targets = this.targetsByComponent.get(id)!;
      const component = this.graph.components[id];
      this.inFlight.add(id);
      if (component.cyclic) {
        const entry = this.receiptsByComponent.get(id)!.pop()!;
        this.consume(id, entry.target);
        result.push(entry);
        continue;
      }
      for (const target of targets.values()) {
        if (target.sequential) {
          result.push({ target, record: this.consume(id, target) });
          continue;
        }
        while (target.records.length)
          result.push({ target, record: this.consume(id, target) });
      }
    }
    this.ready.clear();
    return result;
  }

  /**
   * 消费当前目标的最后完成收据，目标耗尽时立即删除索引，后续批次不再扫描空目标。
   * @param componentId - 收据所属依赖分量。
   * @param target - 保存有序收据的目标。
   * @returns 当前取出的收据。
   */
  private consume(componentId: number, target: CompensationTarget<T>): T {
    const record = target.records.pop()!;
    if (target.records.length) return record;
    this.targetsByComponent.get(componentId)!.delete(target.id);
    this.remaining.delete(target.id);
    return record;
  }

  /**
   * 只沿已耗尽分量的直接前驱递减依赖计数，每条凝聚图边在整个计划中处理一次。
   * @param candidates - 初始汇点或上一批已经完成的分量。
   */
  private activate(candidates: number[]): void {
    for (let position = 0; position < candidates.length; position++) {
      const id = candidates[position];
      if (this.targetsByComponent.get(id)?.size) {
        this.ready.add(id);
        continue;
      }
      for (const previous of this.graph.components[id].predecessors) {
        this.unresolvedSuccessors[previous]--;
        if (this.unresolvedSuccessors[previous] === 0)
          candidates.push(previous);
      }
    }
  }
}
