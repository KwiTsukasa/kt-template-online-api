import { InclusiveGateway, ParallelGateway } from 'bpmn-elements';

/**
 * 对包容汇合启用活动分支监测，等待仍可能到达的令牌；分流继续逐条计算条件。
 * @param definition - 保留包容网关类型及条件引用的标准元素。
 * @param context - 当前流程作用域的活动和顺序流上下文。
 * @returns 可持久化恢复的条件分流或活动分支汇合实例。
 */
export function WorkflowInclusiveGateway(definition: any, context: any) {
  const sources = new Set(context.getInboundSequenceFlows(definition.id).map((flow: any) => flow.sourceId));
  if (sources.size > 1) return new ParallelGateway(definition, context);
  return InclusiveGateway(definition, context);
}
