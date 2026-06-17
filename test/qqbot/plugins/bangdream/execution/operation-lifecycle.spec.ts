import {
  createBangDreamOperationLifecycleContext,
  BangDreamOperationLifecycle,
} from '@/modules/qqbot/plugins/bangdream/src/application/execution/operation-lifecycle';

describe('BangDream operation lifecycle', () => {
  it('emits simple lifecycle observers by configured order', async () => {
    const events: string[] = [];
    const lifecycle = new BangDreamOperationLifecycle([
      {
        /**
         * 执行 BangDream回调。
         */
        afterOutput: () => {
          events.push('afterOutput:2');
        },
        /**
         * 执行 BangDream回调。
         */
        beforeParse: () => {
          events.push('beforeParse:2');
        },
        name: 'second',
        order: 2,
      },
      {
        /**
         * 执行 BangDream回调。
         */
        afterOutput: () => {
          events.push('afterOutput:1');
        },
        /**
         * 执行 BangDream回调。
         */
        beforeParse: () => {
          events.push('beforeParse:1');
        },
        name: 'first',
        order: 1,
      },
    ]);
    const context = createBangDreamOperationLifecycleContext(
      'bangdream.song.search',
      {
        text: '夏祭り',
      },
    );

    await lifecycle.beforeParse(context);
    await lifecycle.afterOutput(context);

    expect(events).toEqual([
      'beforeParse:1',
      'beforeParse:2',
      'afterOutput:1',
      'afterOutput:2',
    ]);
  });

  it('passes shared context and error to error observers', async () => {
    const errors: string[] = [];
    const lifecycle = new BangDreamOperationLifecycle([
      {
        name: 'error-recorder',
        /**
         * 执行 BangDream回调。
         * @param context - context 输入；使用 `operationKey`、`stage` 字段生成结果。
         * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
         */
        onError: (context, error) => {
          errors.push(`${context.operationKey}:${context.stage}:${error}`);
        },
      },
    ]);
    const context = createBangDreamOperationLifecycleContext(
      'bangdream.event.search',
      {
        args: ['50'],
      },
    );
    context.stage = 'handler';

    await lifecycle.onError(context, '活动渲染失败');

    expect(context.query).toBe('50');
    expect(errors).toEqual(['bangdream.event.search:handler:活动渲染失败']);
  });
});
