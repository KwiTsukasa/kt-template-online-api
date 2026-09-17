import type { WorkflowBpmnJob } from '@/modules/workflow-engine/infrastructure/workflow-bpmn.runtime';
import { WorkflowBpmnFlowIndex } from '@/modules/workflow-engine/infrastructure/workflow-bpmn-flow-index';
import { WorkflowCompensationPlan } from '@/modules/workflow-engine/infrastructure/workflow-bpmn-compensation-plan';
import {
  appendCompensationSnapshot,
  nextCompensationOrder,
  readyCompensationSnapshots,
} from '@/modules/workflow-engine/infrastructure/workflow-bpmn-compensation-scope';
import { Queue } from 'smqp';
import { WorkflowBpmnScopeIndex } from '@/modules/workflow-engine/infrastructure/workflow-bpmn-scope-index';

const flow = (sourceId: string, targetId: string) => ({
  id: `${sourceId}:${targetId}`,
  sourceId,
  targetId,
});
const target = (id: string, orders: number[]) => ({
  id,
  activityId: id,
  sequential: false,
  records: orders.map((order) => ({ order })),
});

describe('工作流图与补偿的线性遍历', () => {
  it.each([100, 1000, 10_000])(
    '连续完成 %i 个宿主时，历史补偿快照不会被逐次出入队',
    (count) => {
      const queue = new Queue('scope', { durable: true });
      const get = jest.spyOn(queue, 'get');
      for (let index = 0; index < count; index++) {
        appendCompensationSnapshot(queue, {
          handlerId: 'handler',
          variables: {},
          executionId: `child-${index}`,
          rootExecutionId: `root-${index}`,
          ready: false,
          ktCompensationOrder: index + 1,
          children: [],
        });
        readyCompensationSnapshots(queue, `root-${index}`);
      }
      expect(get).not.toHaveBeenCalled();
      expect(queue.messageCount).toBe(count);
      expect(
        queue.getState()?.messages?.every((message) => message.content.ready),
      ).toBe(true);
    },
  );
  it('恢复未结束宿主时仅启用指定根收据，保留其他实例的原期限与数据', () => {
    const queue = new Queue('restored', { durable: true });
    const records = ['a', 'b'].map((rootExecutionId) => ({
      fields: {
        exchange: '',
        routingKey: '',
        consumerTag: '',
        redelivered: false,
      },
      properties: {},
      content: {
        rootExecutionId,
        ready: false,
        variables: { token: rootExecutionId },
      },
    }));
    queue.recover({
      name: 'restored',
      options: { durable: true },
      messages: records,
    });
    readyCompensationSnapshots(queue, 'b');
    expect(
      queue.getState()?.messages?.map((message) => message.content),
    ).toEqual([
      { ...records[0].content, ready: false },
      { ...records[1].content, ready: true },
    ]);
  });
  it.each([100, 1000, 10_000])(
    '撤销 %i 个独立作用域时只访问各自任务，替换和重复撤销不残留归属',
    (size) => {
      const jobs = new WorkflowBpmnScopeIndex<WorkflowBpmnJob>();
      let reads = 0;
      for (let index = 0; index < size; index++)
        jobs.set(String(index), {
          executionId: String(index),
          elementId: 'task',
          step: { kind: 'action', taskRef: { id: '1', version: 1 }, input: {} },
          variables: {},
          get parentExecutionIds() {
            reads++;
            return ['root', `scope-${index}`];
          },
        });
      const cancelled = new Set<string>();
      for (let index = 0; index < size; index++)
        jobs.cancelScope(`scope-${index}`, cancelled);
      expect(cancelled.size).toBe(size);
      expect([...jobs.values()]).toHaveLength(0);
      expect(reads).toBeLessThanOrEqual(size * 2);
      jobs.cancelScope('root', cancelled);
      expect(reads).toBeLessThanOrEqual(size * 2);
    },
  );
  it('通过无补偿节点传递依赖，互不依赖的末端同批处理', () => {
    const plan = new WorkflowCompensationPlan(
      [
        flow('A', 'bridge'),
        flow('bridge', 'B'),
        flow('B', 'C'),
        flow('B', 'D'),
      ],
      [target('A', [1]), target('B', [2]), target('C', [3]), target('D', [4])],
      (record) => record.order,
    );
    expect(new Set(plan.take().map((item) => item.target.id))).toEqual(
      new Set(['C', 'D']),
    );
    expect(plan.take().map((item) => item.target.id)).toEqual(['B']);
    expect(plan.take().map((item) => item.target.id)).toEqual(['A']);
    expect(plan.remainingTargets().size).toBe(0);
  });

  it('回环按实际完成逆序逐份补偿，支持 32 位以上的安全整数序号', () => {
    const plan = new WorkflowCompensationPlan(
      [flow('A', 'B'), flow('B', 'A')],
      [
        target('A', [1, 2 ** 40]),
        target('B', [2 ** 32, Number.MAX_SAFE_INTEGER]),
      ],
      (record) => record.order,
    );
    const result: number[] = [];
    while (plan.remainingTargets().size)
      result.push(...plan.take().map((item) => item.record.order));
    expect(result).toEqual([Number.MAX_SAFE_INTEGER, 2 ** 40, 2 ** 32, 1]);
  });

  it('批量反向索引不能穿过网关回边把下一轮入口算进当前轮', () => {
    const index = new WorkflowBpmnFlowIndex([
      flow('A', 'B'),
      flow('B', 'G'),
      flow('G', 'C'),
      flow('C', 'G'),
    ]);
    expect(index.originsBefore('G', ['B:G'])).toEqual(new Set(['B', 'A']));
    expect(index.originsBefore('G', ['C:G'])).toEqual(new Set(['C', 'G']));
  });

  it.each([100, 1000, 10_000])(
    '完整派发 %i 个串行补偿目标时，边和收据读取保持线性',
    (size) => {
      let flowReads = 0;
      let orderReads = 0;
      let recordReads = 0;
      const flows = Array.from({ length: size - 1 }, (_, index) => ({
        id: `flow-${index}`,
        get sourceId() {
          flowReads++;
          return String(index);
        },
        get targetId() {
          flowReads++;
          return String(index + 1);
        },
      }));
      const targets = Array.from({ length: size }, (_, index) => ({
        ...target(String(index), [index]),
        records: new Proxy([{ order: index }], {
          get: (array, key, receiver) => {
            if (
              key === 'length' ||
              (typeof key === 'string' && /^\d+$/.test(key))
            )
              recordReads++;
            return Reflect.get(array, key, receiver);
          },
        }),
      }));
      const plan = new WorkflowCompensationPlan(flows, targets, (record) => {
        orderReads++;
        return record.order;
      });
      let dispatched = 0;
      while (plan.remainingTargets().size) {
        const batch = plan.take();
        expect(batch).toHaveLength(1);
        expect(batch[0].record.order).toBe(size - dispatched - 1);
        dispatched++;
      }
      expect(dispatched).toBe(size);
      expect(orderReads).toBe(size);
      expect(flowReads).toBeLessThanOrEqual(size * 12);
      expect(recordReads).toBeLessThanOrEqual(size * 12);
    },
  );

  it('同一恢复上下文连续完成活动时只扫描一次旧收据', () => {
    const getState = jest.fn(() => ({
      messages: [{ content: { ktCompensationOrder: 40 } }],
    }));
    const getActivities = jest.fn(() => [
      { broker: { getQueue: () => ({ getState }) } },
    ]);
    const context = { getActivities } as never;
    for (let index = 1; index <= 1000; index++)
      expect(nextCompensationOrder(context, 'scope')).toBe(40 + index);
    expect(getActivities).toHaveBeenCalledTimes(1);
    expect(getState).toHaveBeenCalledTimes(2);
  });
});
