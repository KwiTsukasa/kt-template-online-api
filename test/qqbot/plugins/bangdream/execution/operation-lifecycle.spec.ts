import {
  createBangDreamOperationLifecycleContext,
  BangDreamOperationLifecycle,
} from '@/modules/qqbot/plugins/bangdream/src/application/execution/operation-lifecycle';

describe('BangDream operation lifecycle', () => {
  it('emits simple lifecycle observers by configured order', async () => {
    const events: string[] = [];
    const lifecycle = new BangDreamOperationLifecycle([
      {
        afterOutput: () => {
          events.push('afterOutput:2');
        },
        beforeParse: () => {
          events.push('beforeParse:2');
        },
        name: 'second',
        order: 2,
      },
      {
        afterOutput: () => {
          events.push('afterOutput:1');
        },
        beforeParse: () => {
          events.push('beforeParse:1');
        },
        name: 'first',
        order: 1,
      },
    ]);
    const context = createBangDreamOperationLifecycleContext('bangdream.song.search', {
      text: '夏祭り',
    });

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
        onError: (context, error) => {
          errors.push(`${context.operationKey}:${context.stage}:${error}`);
        },
      },
    ]);
    const context = createBangDreamOperationLifecycleContext('bangdream.event.search', {
      args: ['50'],
    });
    context.stage = 'handler';

    await lifecycle.onError(context, '活动渲染失败');

    expect(context.query).toBe('50');
    expect(errors).toEqual(['bangdream.event.search:handler:活动渲染失败']);
  });
});
