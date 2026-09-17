import { randomUUID } from 'node:crypto';
import { workflowBpmnChildParent } from './workflow-bpmn-scope';
import { SubProcess, SubProcessBehaviour } from 'bpmn-elements/tasks';

/**
 * 保留普通子流程行为，为事件触发的子流程在同一活动内建立独立、可恢复的处理实例。
 * @param definition - 含标准事件触发标志的子流程定义。
 * @param context - 当前父流程的引擎上下文。
 * @returns 支持重复事件触发的标准子流程活动。
 */
export function WorkflowEventSubProcess(definition: any, context: any) {
  if (!definition.behaviour?.triggeredByEvent)
    return SubProcess(definition, context);
  const activity: any = SubProcess(
    definition,
    context,
    WorkflowEventSubProcessBehaviour as any,
  );
  const run = activity.run.bind(activity);
  activity.run = (content) => {
    // 父作用域的正常令牌耗尽后只等待已有处理实例，不能由处理器自身再启动一轮。
    if (
      !context
        .getActivities(activity.parent.id)
        .some((sibling: any) => !sibling.triggeredByEvent && sibling.isRunning)
    )
      return;
    if (!activity.isRunning) return run(content);
    if (
      activity
        .getStartActivities()
        .some((start: any) => start.behaviour.isInterrupting !== false)
    )
      return;
    const source = activity.execution
      ?.source as WorkflowEventSubProcessBehaviour;
    source.trigger(content);
  };
  return activity;
}

class WorkflowEventSubProcessBehaviour extends (SubProcessBehaviour as any) {
  private rootContent: any;

  constructor(activity: any, context: any) {
    super(activity, context);
    // 使用引擎已有的多执行作用域保存与清理能力，事件次数由触发决定，不生成伪循环模型。
    this.loopCharacteristics = {
      execute: (message: any) => {
        this.rootContent = structuredClone(message.content);
        if (!message.fields.redelivered) this.trigger(message.content);
        else if (
          this.executions.some(
            (execution: any) =>
              execution.executionId === message.content.executionId,
          )
        ) {
          // 旧快照直接以活动根身份执行子流程，恢复时保留该身份和内部待办。
          this.broker.publish('execution', 'execute.legacy.running', {
            ...message.content,
            preventComplete: true,
          });
          super.execute({
            ...message,
            content: { ...message.content, isRootScope: false },
          });
        }
      },
    };
  }

  /**
   * 旧快照的根处理结束时保留新建的并发处理，最后一个实例完成才结束活动。
   * @param routingKey - 子流程的完成、撤销或错误结果通道。
   * @param content - 已结束处理实例的固定执行身份。
   */
  _completeExecution(routingKey: string, content: any): void {
    if (
      content.executionId === this.rootContent?.executionId &&
      routingKey === 'execute.completed'
    ) {
      if (
        this.executions.some(
          (execution: any) =>
            execution.executionId !== content.executionId &&
            !execution.completed,
        )
      ) {
        super._completeExecution('execute.legacy.completed', {
          ...content,
          isRootScope: true,
          preventComplete: false,
        });
        return;
      }
      super._completeExecution(routingKey, { ...content, isRootScope: true });
      return;
    }
    super._completeExecution(routingKey, content);
  }

  /**
   * 为本次事件建立独立执行身份，内部活动使用各自的子流程上下文。
   * @param input - 此次触发的事件数据；不允许改变标准活动身份和父作用域。
   */
  trigger(input: Record<string, unknown>): void {
    const root = this.rootContent;
    const parent = workflowBpmnChildParent(root);
    this.broker.publish('execution', 'execute.start', {
      ...root,
      input,
      executionId: `${root.executionId}_${randomUUID()}`,
      isRootScope: false,
      parent,
    });
  }
}
