export function toTree<T extends { id: string; pid?: string | null }>(
  nodes: T[],
) {
  const map = new Map<string, T & { children?: T[] }>();
  nodes.forEach((node) => map.set(node.id, { ...node }));

  const roots: Array<T & { children?: T[] }> = [];
  map.forEach((node) => {
    const parent = node.pid ? map.get(node.pid) : null;
    if (parent) {
      parent.children = parent.children || [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}
