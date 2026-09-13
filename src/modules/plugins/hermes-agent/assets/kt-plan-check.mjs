const normalized = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();

/**
 * 比较攻略适用场景、已观察持有项和候选配置，列出混用来源与未持有项。
 * @param input - 当前目标、带来源的持有记录、已读取来源及待检查方案。
 * @returns 逐项核对结果与未解决条件；只验证提交证据的一致性，不替代图片识别或来源事实核验。
 * @throws 输入规模、来源标识或候选配置结构无效时拒绝核对。
 */
export function checkPlan(input) {
  const { scope, inventory, sources, plans } = input;
  if (!scope || !normalized(scope.game))
    throw new Error('需要核对目标所属的游戏');
  if (
    !Array.isArray(inventory) ||
    !Array.isArray(sources) ||
    !Array.isArray(plans)
  )
    throw new Error('持有记录、已读取来源和候选方案必须使用列表');
  if (
    inventory.length > 300 ||
    sources.length > 40 ||
    plans.length > 20 ||
    !plans.length
  )
    throw new Error('最多核对300项持有记录、40份来源和20个候选方案');
  const sourceMap = new Map();
  for (const source of sources) {
    if (
      typeof source.id !== 'string' ||
      !source.id ||
      sourceMap.has(source.id) ||
      !source.reference ||
      !source.scope
    )
      throw new Error('来源必须有唯一ID、原始链接或消息引用以及适用场景');
    sourceMap.set(source.id, source);
  }
  const owned = new Map();
  for (const item of inventory) {
    if (
      !normalized(item.name) ||
      !item.reference ||
      !['message', 'image'].includes(item.basis)
    )
      throw new Error('持有记录必须给出名称和原始消息或图片引用');
    owned.set(normalized(item.name), item);
  }
  const dimensions = ['game', 'region', 'version', 'mode', 'stage'];
  const results = plans.map((plan) => {
    if (
      typeof plan.name !== 'string' ||
      !Array.isArray(plan.items) ||
      plan.items.length > 100 ||
      !Array.isArray(plan.sourceIds)
    )
      throw new Error('方案必须包含名称、最多100个配置项和来源ID');
    const issues = [];
    const itemNames = plan.items.map(normalized);
    if (
      itemNames.some((name) => !name) ||
      new Set(itemNames).size !== itemNames.length
    )
      issues.push({ code: 'invalid_or_duplicate_items' });
    const missing = plan.items.filter((name) => !owned.has(normalized(name)));
    if (missing.length)
      issues.push({ code: 'not_in_observed_inventory', items: missing });
    const uncertain = plan.items.filter(
      (name) => owned.get(normalized(name))?.confirmed !== true,
    );
    if (uncertain.length)
      issues.push({
        code: 'inventory_identification_unconfirmed',
        items: uncertain,
      });
    if (
      Number.isInteger(input.requiredCount) &&
      plan.items.length !== input.requiredCount
    )
      issues.push({
        code: 'configuration_count_mismatch',
        expected: input.requiredCount,
        actual: plan.items.length,
      });
    if (!plan.sourceIds.length) issues.push({ code: 'no_read_source' });
    for (const id of plan.sourceIds) {
      const source = sourceMap.get(id);
      if (!source) {
        issues.push({ code: 'unknown_source', sourceId: id });
        continue;
      }
      for (const dimension of dimensions) {
        if (!normalized(scope[dimension])) continue;
        if (!normalized(source.scope[dimension]))
          issues.push({
            code: 'source_scope_unknown',
            sourceId: id,
            dimension,
          });
        else if (
          normalized(scope[dimension]) !== normalized(source.scope[dimension])
        )
          issues.push({
            code: 'source_scope_mismatch',
            sourceId: id,
            dimension,
            expected: scope[dimension],
            actual: source.scope[dimension],
          });
      }
    }
    return { name: plan.name, consistent: issues.length === 0, issues };
  });
  return {
    scope,
    results,
    consistent: results.every((row) => row.consistent),
    checked: [
      '来源适用场景',
      '持有记录中的精确名称',
      '识别确认状态',
      '配置数量',
    ],
    limitation:
      '此工具核对传入证据的结构与一致性，不证明来源本身正确，也不保证战斗结果。先读取原图和原文，不能把推测填成已确认持有。',
  };
}
