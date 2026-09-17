import { BPMN_ROUTING } from '../constants/bpmn-runtime';
import { SubProcessBehaviour } from 'bpmn-elements/tasks';
import type {
  Activity,
  ActivityDefinition,
  ContextInstance,
  ElementBrokerMessage,
  ElementMessageContent,
  IApi,
  ProcessExecution,
  ProcessExecutionState,
} from 'bpmn-elements';
import type { ConsumeMessage, MessageProperties } from 'smqp';
import { configureWorkflowCompensationThrow } from './workflow-bpmn-compensation';
import { workflowBpmnChildParent } from './workflow-bpmn-scope';
import {
  CompensationScopeBehaviour,
  WorkflowCompensatableSubProcess,
} from './workflow-bpmn-compensation-scope';

// 18.0.27 的事务取消未公开扩展钩子；内部方法和符号集中声明，由消融与旧快照恢复用例保护。
const executionStatus: unique symbol = Symbol.for('status');
const messageHandlers: unique symbol = Symbol.for('messageHandlers');
const configured = new WeakSet<ProcessExecution>();
type TransactionState = ProcessExecutionState & {
  ktCompensation?: ElementMessageContent;
};
type TransactionSnapshot =
  | TransactionState
  | { executions: TransactionState[] };

interface TransactionExecution extends ProcessExecution {
  [executionStatus]: string;
  [messageHandlers]: {
    onChildMessage: (routingKey: string, message: ConsumeMessage) => void;
  };
  _onCancel: () => void;
  _complete: (type: string, content: ElementMessageContent) => void;
  _getChildApi: (message: ElementBrokerMessage) => IApi<Activity>;
}

interface NativeTransactionBehaviour extends Omit<
  SubProcessBehaviour,
  'recover' | 'executions'
> {
  executions: TransactionExecution[];
  recover(state?: TransactionSnapshot): void;
  _upsertExecution(message: ElementBrokerMessage): TransactionExecution;
}

// 上游声明将实际单对象/循环对象误写成数组；这里只校正适配边界，不改变持久化结构。
const NativeSubProcess = CompensationScopeBehaviour as unknown as new (
  activity: Activity,
  context: ContextInstance,
) => NativeTransactionBehaviour;

/**
 * 事务仍由原生子流程处理取消与出口，补偿改用可恢复的依赖逆序调度。
 * @param definition - 固定版本中的事务活动定义。
 * @param context - 此事务所属作用域的引擎上下文。
 * @returns 保留原生事务身份与循环能力的子流程活动。
 */
export function WorkflowTransaction(
  definition: ActivityDefinition,
  context: ContextInstance,
): Activity {
  return WorkflowCompensatableSubProcess(
    { ...definition, isTransaction: true },
    context,
    WorkflowTransactionBehaviour,
  );
}

class WorkflowTransactionBehaviour extends NativeSubProcess {
  /**
   * 在原生执行作用域建立后安装取消补偿适配，循环实例互不共享调度状态。
   * @param message - 当前事务实例的执行消息。
   * @returns 已安装补偿调度的原生事务执行作用域。
   */
  _upsertExecution(message: ElementBrokerMessage): TransactionExecution {
    const execution = super._upsertExecution(message);
    configureTransactionCompensation(execution);
    return execution;
  }

  /**
   * 原生恢复创建的每个事务作用域继续自己的补偿阶段，不重新派发已完成的处理器。
   * @param state - 单个或循环事务持久化的执行状态。
   */
  recover(state?: TransactionSnapshot): void {
    super.recover(state);
    if (!state) return;
    let states = [state as TransactionState];
    if ('executions' in state) states = state.executions;
    const byExecution = new Map(states.map((item) => [item.executionId, item]));
    for (const execution of this.executions) {
      const saved = byExecution.get(execution.executionId);
      configureTransactionCompensation(execution, saved?.ktCompensation);
    }
  }
}

/**
 * 截取原生取消中的补偿广播，保留即时撤销活动，再按同一作用域依赖推进补偿并保存等待身份。
 * @param execution - 原生事务执行作用域，其活动与队列仍由引擎持有。
 * @param restored - 恢复时尚未结束的补偿调度内容。
 */
function configureTransactionCompensation(
  execution: TransactionExecution,
  restored?: ElementMessageContent,
): void {
  if (configured.has(execution)) return;
  configured.add(execution);
  let state = restored;
  let starting = false;
  const nativeCancel = execution._onCancel.bind(execution);
  const nativeResume = execution.resume.bind(execution);
  const nativeState = execution.getState.bind(execution);
  const nativeComplete = execution._complete.bind(execution);
  execution._complete = (type, content) => {
    // 未捕获的补偿错误必须向外传播，不能被原生取消状态覆盖成正常取消出口。
    if (type === 'error' && execution.status === 'cancel') {
      state = undefined;
      execution[executionStatus] = 'error';
    }
    if (
      type === 'completed' &&
      execution.status === 'cancel' &&
      (state || starting)
    )
      return;
    return nativeComplete(type, content);
  };
  const handlers = execution[messageHandlers];
  const childMessage = handlers.onChildMessage;
  handlers.onChildMessage = (routingKey, message) => {
    // 两个补偿阶段之间仍有待补偿边界，不能让原生的“仅剩脱离活动”清理提前结束事务。
    if (
      routingKey === BPMN_ROUTING.executionDiscardDetached &&
      (state || starting)
    )
      return message.ack();
    return childMessage(routingKey, message);
  };
  const broker = new Proxy(execution.broker, {
    get: (target, key) => {
      if (key === 'publish')
        return (
          exchange: string,
          routingKey: string,
          content: ElementMessageContent,
          properties?: MessageProperties,
        ) => {
          if (
            exchange === 'execution' &&
            routingKey === BPMN_ROUTING.executeCompensating
          ) {
            state = structuredClone(content);
            return;
          }
          if (
            exchange === 'execution' &&
            routingKey === BPMN_ROUTING.executeCompleted
          ) {
            for (const api of execution.getPostponed())
              if (api.content.expect === 'compensate') api.discard();
            state = undefined;
            nativeComplete('completed', undefined);
            return;
          }
          if (
            exchange === 'event' &&
            routingKey === BPMN_ROUTING.activityCompensate
          )
            return;
          return target.publish(exchange, routingKey, content, properties);
        };
      const value = Reflect.get(target, key, target);
      if (typeof value === 'function') return value.bind(target);
      return value;
    },
  });
  const start = (content: ElementMessageContent) => {
    const source: {
      executeThrow?: (message: { content: ElementMessageContent }) => void;
    } = {};
    configureWorkflowCompensationThrow(
      source,
      { id: execution.id, parent: { id: execution.id }, broker },
      { behaviour: {} },
      execution.context,
    );
    source.executeThrow({ content });
  };
  execution._onCancel = () => {
    if (state || starting) return;
    starting = true;
    const childApi = execution._getChildApi;
    execution._getChildApi = (message) => {
      const api = childApi.call(execution, message);
      if (message.content.expect !== 'compensate') return api;
      return { ...api, sendApiMessage: () => undefined };
    };
    try {
      nativeCancel();
    } finally {
      execution._getChildApi = childApi;
    }
    const content = execution.getApi().content;
    const parent = workflowBpmnChildParent({
      ...content,
      id: execution.id,
      type: execution.type,
      executionId: execution.executionId,
    });
    start({
      ...content,
      executionId: `${execution.executionId}:compensation`,
      parent,
    });
    starting = false;
  };
  execution.getState = () => ({ ...nativeState(), ktCompensation: state });
  execution.resume = () => {
    nativeResume();
    if (state) start(state);
  };
}
