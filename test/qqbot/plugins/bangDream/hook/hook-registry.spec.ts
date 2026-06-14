import {
  createTsuguHookContext,
  TsuguHookRegistry,
} from '@/modules/qqbot/plugins/bangDream/hook/hook-registry';

describe('BangDream Tsugu hook registry', () => {
  it('emits simple lifecycle hooks by configured order', async () => {
    const events: string[] = [];
    const registry = new TsuguHookRegistry([
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
    const context = createTsuguHookContext('bangdream.song.search', {
      text: '夏祭り',
    });

    await registry.beforeParse(context);
    await registry.afterOutput(context);

    expect(events).toEqual([
      'beforeParse:1',
      'beforeParse:2',
      'afterOutput:1',
      'afterOutput:2',
    ]);
  });

  it('passes shared context and error to error hooks', async () => {
    const errors: string[] = [];
    const registry = new TsuguHookRegistry([
      {
        name: 'error-recorder',
        onError: (context, error) => {
          errors.push(`${context.operationKey}:${context.stage}:${error}`);
        },
      },
    ]);
    const context = createTsuguHookContext('bangdream.event.search', {
      args: ['50'],
    });
    context.stage = 'handler';

    await registry.onError(context, '活动渲染失败');

    expect(context.query).toBe('50');
    expect(errors).toEqual(['bangdream.event.search:handler:活动渲染失败']);
  });
});
