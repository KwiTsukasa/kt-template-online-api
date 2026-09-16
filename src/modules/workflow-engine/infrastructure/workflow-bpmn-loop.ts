import { MultiInstanceLoopCharacteristics } from 'bpmn-elements';

/**
 * 在派生多实例前校验实际数量，动态字段与固定数量遵守同一上限。
 * @param activity - 多实例所附着的标准活动。
 * @param definition - 含数量表达式的固定循环配置。
 * @returns 保留标准顺序、并行和恢复语义的受限多实例行为。
 * @throws 数量不是零至一千的整数时拒绝展开活动。
 */
export function WorkflowMultiInstance(activity: any, definition: any) {
  const loop = new MultiInstanceLoopCharacteristics(activity, definition);
  const execute = loop.execute.bind(loop);
  loop.execute = (message) => {
    if (!message.fields?.redelivered && definition.behaviour.loopCardinality !== undefined) {
      const expression = definition.behaviour.loopCardinality;
      let count = activity.environment.resolveExpression(expression, message);
      if (typeof expression === 'string' && /^\d+$/.test(expression)) count = Number(expression);
      if (typeof count !== 'number') throw new Error('多实例数量必须为零至一千的整数');
      if (!Number.isSafeInteger(count) || count < 0 || count > 1000) throw new Error('多实例数量必须为零至一千的整数');
    }
    return execute(message);
  };
  return loop;
}

/**
 * 将标准循环的“条件为真继续”转换为运行库的完成条件，并在前置条件为假时正常消费令牌。
 * @param activity - 标准循环所附着的活动。
 * @param definition - 固定标准模型中的循环属性。
 * @returns 保留循环实例账本与恢复能力的顺序循环行为。
 * @throws 循环条件不是已声明的 JSON 表达式时拒绝执行。
 */
export function WorkflowStandardLoop(activity: any, definition: any) {
  const original = definition.behaviour;
  const behaviour = { ...original, isSequential: true };
  delete behaviour.loopCondition;
  delete behaviour.testBefore;
  if (original.loopCondition) behaviour.completionCondition = JSON.stringify({ op: 'not', value: JSON.parse(original.loopCondition) });
  const loop = new MultiInstanceLoopCharacteristics(activity, { ...definition, behaviour });
  const execute = loop.execute.bind(loop);
  loop.execute = (message) => {
    if (original.testBefore && original.loopCondition && !message.fields?.redelivered && !activity.environment.resolveExpression(original.loopCondition, message)) {
      activity.broker.publish('execution', 'execute.completed', { ...message.content, output: [] });
      return;
    }
    return execute(message);
  };
  return loop;
}
