/**
 * 将`nodes`转换为树形层级。
 * @param nodes - 决定树形层级内容、边界或目标的 `nodes` 值。
 * @returns 树形层级。
 */
export function toTree<T extends { id: string; pid?: string | null }>(
  nodes: T[],
) {
  const map = new Map<string, T & { children?: T[] }>();
  nodes.forEach((node) => map.set(node.id, { ...node }));

  const roots: Array<T & { children?: T[] }> = [];
  map.forEach((node) => {
    const parent = (() => {
      if (node.pid) {
        return map.get(node.pid);
      }
      return null;
    })();
    if (parent) {
      parent.children = parent.children || [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}
