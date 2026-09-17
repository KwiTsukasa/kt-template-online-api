export interface WorkflowSequenceFlow {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface WorkflowFlowComponent {
  members: string[];
  predecessors: Set<number>;
  successors: Set<number>;
  cyclic: boolean;
}

export class WorkflowBpmnFlowIndex {
  private readonly outgoing = new Map<string, WorkflowSequenceFlow[]>();
  private readonly incoming = new Map<string, WorkflowSequenceFlow[]>();
  private readonly byId = new Map<string, WorkflowSequenceFlow>();

  constructor(flows: readonly WorkflowSequenceFlow[]) {
    for (const flow of flows) {
      const outgoing = this.outgoing.get(flow.sourceId) ?? [];
      outgoing.push(flow);
      this.outgoing.set(flow.sourceId, outgoing);
      if (!this.outgoing.has(flow.targetId))
        this.outgoing.set(flow.targetId, []);
      const incoming = this.incoming.get(flow.targetId) ?? [];
      incoming.push(flow);
      this.incoming.set(flow.targetId, incoming);
      this.byId.set(flow.id, flow);
    }
  }

  /**
   * 从一组网关入口反向遍历来源节点，在网关处截断回环；所有入口共享一次遍历。
   * @param gatewayId - 本轮汇合网关，不能跨过其出口访问下一轮。
   * @param flowIds - 需要查询的入口连线身份。
   * @returns 能在不经过目标网关的情况下到达任一指定入口的节点集合。
   */
  originsBefore(gatewayId: string, flowIds: Iterable<string>): Set<string> {
    const origins = new Set<string>();
    const pending: string[] = [];
    for (const id of flowIds) {
      const flow = this.byId.get(id);
      if (!flow || flow.targetId !== gatewayId || origins.has(flow.sourceId))
        continue;
      origins.add(flow.sourceId);
      pending.push(flow.sourceId);
    }
    for (let position = 0; position < pending.length; position++) {
      const id = pending[position];
      if (id === gatewayId) continue;
      for (const flow of this.incoming.get(id) ?? []) {
        if (origins.has(flow.sourceId)) continue;
        origins.add(flow.sourceId);
        pending.push(flow.sourceId);
      }
    }
    return origins;
  }

  /**
   * 将回环收缩成无环依赖图，正反两次迭代深搜各访问节点和边一次，不生成两两可达矩阵。
   * @param isolated - 可能没有顺序流的活动身份，仍须拥有独立分量。
   * @returns 节点到分量的映射及分量的直接前驱、后继与回环标记。
   */
  condense(isolated: Iterable<string> = []): {
    componentByNode: Map<string, number>;
    components: WorkflowFlowComponent[];
  } {
    const nodes = new Set([...this.outgoing.keys(), ...isolated]);
    const visited = new Set<string>();
    const finished: string[] = [];
    for (const root of nodes) {
      if (visited.has(root)) continue;
      visited.add(root);
      const stack = [{ id: root, position: 0 }];
      while (stack.length) {
        const current = stack[stack.length - 1];
        const flows = this.outgoing.get(current.id) ?? [];
        if (current.position >= flows.length) {
          finished.push(current.id);
          stack.pop();
          continue;
        }
        const targetId = flows[current.position++].targetId;
        if (visited.has(targetId)) continue;
        visited.add(targetId);
        stack.push({ id: targetId, position: 0 });
      }
    }
    const componentByNode = new Map<string, number>();
    const components: WorkflowFlowComponent[] = [];
    for (let position = finished.length - 1; position >= 0; position--) {
      const root = finished[position];
      if (componentByNode.has(root)) continue;
      const id = components.length;
      const members = [root];
      componentByNode.set(root, id);
      for (let cursor = 0; cursor < members.length; cursor++) {
        for (const flow of this.incoming.get(members[cursor]) ?? []) {
          if (componentByNode.has(flow.sourceId)) continue;
          componentByNode.set(flow.sourceId, id);
          members.push(flow.sourceId);
        }
      }
      components.push({
        members,
        predecessors: new Set(),
        successors: new Set(),
        cyclic: members.length > 1,
      });
    }
    for (const flow of this.byId.values()) {
      const source = componentByNode.get(flow.sourceId)!;
      const target = componentByNode.get(flow.targetId)!;
      if (source === target) {
        if (flow.sourceId === flow.targetId) components[source].cyclic = true;
        continue;
      }
      components[source].successors.add(target);
      components[target].predecessors.add(source);
    }
    return { componentByNode, components };
  }
}
