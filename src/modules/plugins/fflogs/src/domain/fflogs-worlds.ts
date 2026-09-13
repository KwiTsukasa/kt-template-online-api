export type FflogsWorldEntry = {
  label?: string;
  value?: string;
  children?: FflogsWorldEntry[];
  childrenCode?: string;
  dictCode?: string;
};

/**
 * 从公开字典契约提取服务器名称与完整路径，不依赖市场插件实现或运行状态。
 * @param roots - 地区、大区、服务器的字典树。
 * @param worlds - 字典树不可用时的服务器平面目录。
 * @returns 可验证名称及路径到实际服务器名的映射。
 */
export function buildFflogsWorldNames(
  roots: FflogsWorldEntry[],
  worlds: FflogsWorldEntry[],
): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (nodes: FflogsWorldEntry[], parents: string[]) => {
    for (const node of nodes) {
      const name = String(node.label || node.value || '').trim();
      if (!name) continue;
      const path = [...parents, name];
      if (
        node.dictCode === 'FF14_MARKET_WORLD' ||
        (!node.children?.length && parents.length >= 2)
      ) {
        names.set(name, name);
        if (node.value) names.set(node.value, name);
        for (const separator of ['/', '>', '->', ':', '：']) {
          names.set(path.join(separator), name);
          names.set(path.slice(-2).join(separator), name);
        }
      }
      if (node.children?.length) walk(node.children, path);
    }
  };
  walk(roots, []);
  for (const world of worlds) {
    const name = String(world.label || world.value || '').trim();
    if (name) {
      names.set(name, name);
      if (world.value) names.set(world.value, name);
    }
  }
  return names;
}
