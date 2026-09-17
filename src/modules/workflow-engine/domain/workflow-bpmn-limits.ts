export const WORKFLOW_BPMN_LIMITS = Object.freeze({
  maxInstances: 1000,
  synchronousTransitions: 10000,
});

/**
 * 让发布校验和实际展开使用同一数量边界，动态业务输入不能绕过静态模型校验。
 * @param value - 已求值的多实例数量；不接受数字字符串或隐式类型转换。
 * @returns 已核验的非负整数数量。
 * @throws 数量不是安全整数或超过工作流实例上限时拒绝展开。
 */
export function requireBpmnInstanceCount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > WORKFLOW_BPMN_LIMITS.maxInstances
  ) {
    throw new Error('多实例数量必须为零至一千的整数');
  }
  return value;
}
