interface WorkflowSequenceFlow {
  id: string;
  sourceId: string;
  targetId: string;
}

export class WorkflowBpmnFlowIndex {
  private readonly outgoing = new Map<string, WorkflowSequenceFlow[]>();
  private readonly reachable = new Map<string, Set<string>>();

  constructor(flows: readonly WorkflowSequenceFlow[]) {
    for (const flow of flows) {
      const outgoing = this.outgoing.get(flow.sourceId) ?? [];
      outgoing.push(flow);
      this.outgoing.set(flow.sourceId, outgoing);
    }
  }

  /**
   * 查询固定作用域内的顺序依赖，同一源节点的结果复用；自达只有存在实际回环时成立。
   * @param sourceId - 开始搜索的节点身份。
   * @param targetId - 需要证明可达的节点身份。
   * @returns 是否存在至少一条顺序流组成的路径。
   */
  reaches(sourceId: string, targetId: string): boolean {
    let targets = this.reachable.get(sourceId);
    if (!targets) {
      targets = new Set([...this.walk(sourceId)].map((flow) => flow.targetId));
      this.reachable.set(sourceId, targets);
    }
    return targets.has(targetId);
  }

  /**
   * 收集当前令牌能到达的网关入口，并在目标网关处停止，避免下一轮回环阻塞本轮汇合。
   * @param sourceId - 持有令牌的节点身份。
   * @param gatewayId - 当前正在判断重置的网关身份。
   * @returns 未经过目标网关出口的可达入口连线集合。
   */
  incomingBefore(sourceId: string, gatewayId: string): Set<string> {
    return new Set(
      [...this.walk(sourceId, gatewayId)]
        .filter((flow) => flow.targetId === gatewayId)
        .map((flow) => flow.id),
    );
  }

  /**
   * 沿已索引的本作用域连线遍历，每个节点最多展开一次，保留回边但不反复遍历。
   * @param sourceId - 本轮遍历的源节点。
   * @param stopAtId - 到达后不再展开出口的可选节点。
   * @returns 遍历中实际经过的连线集合。
   */
  private walk(sourceId: string, stopAtId?: string): Set<WorkflowSequenceFlow> {
    const pending = [sourceId];
    const visited = new Set<string>();
    const result = new Set<WorkflowSequenceFlow>();
    for (let position = 0; position < pending.length; position++) {
      const id = pending[position];
      if (visited.has(id)) continue;
      visited.add(id);
      for (const flow of this.outgoing.get(id) ?? []) {
        result.add(flow);
        if (flow.targetId !== stopAtId) pending.push(flow.targetId);
      }
    }
    return result;
  }
}
