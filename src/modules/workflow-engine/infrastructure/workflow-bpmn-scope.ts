import type { ElementParent } from 'bpmn-elements';

interface WorkflowScopeIdentity {
  id: string;
  type: string;
  executionId: string;
  parent?: ElementParent;
}

/**
 * 将原生父级及扁平祖先路径统一展开，缺失父级时返回空链而非未定义占位。
 * @param parent - 当前活动的原生父级身份。
 * @returns 从最近父级到流程根的身份链，保持原顺序与对象身份。
 */
export function workflowBpmnParentChain(
  parent?: ElementParent,
): Array<Partial<ElementParent>> {
  if (!parent) return [];
  return [parent, ...(parent.path ?? [])];
}

/**
 * 为派生任务、事件处理或补偿建立父作用域，祖先条目去除嵌套路径以避免重复快照。
 * @param content - 派生实例所属活动的固定身份及原父链。
 * @returns 可直接写入引擎消息的父作用域身份，不修改原消息。
 */
export function workflowBpmnChildParent(
  content: WorkflowScopeIdentity,
): ElementParent {
  return {
    id: content.id,
    type: content.type,
    executionId: content.executionId,
    path: workflowBpmnParentChain(content.parent).map((ancestor) => {
      const identity = { ...ancestor };
      delete identity.path;
      return identity;
    }),
  };
}

/**
 * 将事件定义消息提升到活动层时同步提升父链，防止抛出事件和提前出口指向不同作用域。
 * @param parent - 事件定义所在活动的父级身份及祖先路径。
 * @returns 活动层的父身份；根部没有祖先时返回空对象。
 */
export function workflowBpmnOuterParent(
  parent: ElementParent,
): Partial<ElementParent> {
  const outer = { ...parent.path?.[0] };
  if (parent.path?.length > 1) return { ...outer, path: parent.path.slice(1) };
  return outer;
}
