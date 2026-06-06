import { TsuguHookRegistry } from '@/qqbot/plugins/bangDream/hook/hook-registry';
import { TsuguOperationPipeline } from '@/qqbot/plugins/bangDream/application/operation-pipeline';
import type { TsuguOperationDefinition } from '@/qqbot/plugins/bangDream/registry/operation-registry';

const songSearchOperation: TsuguOperationDefinition = {
  description: '查询歌曲',
  handlerName: 'searchSong',
  key: 'bangdream.song.search',
  name: '查曲',
  onlineCommand: {
    aliases: ['查曲'],
    cooldownMs: 1500,
    remark: '查询歌曲',
  },
};

describe('TsuguOperationPipeline', () => {
  it('runs ready check, operation resolve, handler, and output hooks', async () => {
    const events: string[] = [];
    const hookRegistry = new TsuguHookRegistry([
      {
        afterOutput: (context) => {
          events.push(`afterOutput:${context.stage}:${context.imageCount}`);
        },
        afterResolve: (context) => {
          events.push(`afterResolve:${context.stage}:${context.handlerName}`);
        },
        beforeParse: (context) => {
          events.push(`beforeParse:${context.stage}:${context.query}`);
        },
        beforeRender: (context) => {
          events.push(`beforeRender:${context.stage}:${context.handlerName}`);
        },
        name: 'recorder',
      },
    ]);
    const pipeline = new TsuguOperationPipeline({
      executeHandler: async (handlerName, input) => {
        events.push(`handler:${handlerName}:${input.text}`);
        return {
          imageCount: 1,
          operationKey: 'bangdream.song.search',
          query: '夏祭り',
          replyText: '[CQ:image,file=base64://base64-song-card]',
          source: 'Tsugu BangDream Bot 内置源码',
        };
      },
      hookRegistry,
      normalizeError: (error) => `${error}`,
      resolveOperation: () => songSearchOperation,
      waitForReady: async () => {
        events.push('ready');
      },
    });

    const output = await pipeline.run('bangdream.song.search', {
      text: '夏祭り',
    });

    expect(output.imageCount).toBe(1);
    expect(events).toEqual([
      'beforeParse:start:夏祭り',
      'ready',
      'afterResolve:operation:searchSong',
      'beforeRender:handler:searchSong',
      'handler:searchSong:夏祭り',
      'afterOutput:output:1',
    ]);
  });

  it('normalizes unknown operation errors and emits error hook', async () => {
    const errors: string[] = [];
    const pipeline = new TsuguOperationPipeline({
      executeHandler: jest.fn(),
      hookRegistry: new TsuguHookRegistry([
        {
          name: 'error-recorder',
          onError: (context, error) => {
            errors.push(`${context.stage}:${error}`);
          },
        },
      ]),
      normalizeError: (error) =>
        error instanceof Error ? error.message : `${error}`,
      resolveOperation: () => undefined,
      waitForReady: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      pipeline.run('bangdream.song.search', { text: '夏祭り' }),
    ).rejects.toThrow('BangDream 插件能力不存在：bangdream.song.search');
    expect(errors).toEqual([
      'operation:BangDream 插件能力不存在：bangdream.song.search',
    ]);
  });

  it('normalizes handler errors at handler stage', async () => {
    const errors: string[] = [];
    const pipeline = new TsuguOperationPipeline({
      executeHandler: jest.fn().mockRejectedValue('图片渲染失败'),
      hookRegistry: new TsuguHookRegistry([
        {
          name: 'error-recorder',
          onError: (context, error) => {
            errors.push(`${context.stage}:${context.handlerName}:${error}`);
          },
        },
      ]),
      normalizeError: (error) => `${error}`,
      resolveOperation: () => songSearchOperation,
      waitForReady: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      pipeline.run('bangdream.song.search', { text: '夏祭り' }),
    ).rejects.toThrow('图片渲染失败');
    expect(errors).toEqual(['handler:searchSong:图片渲染失败']);
  });
});
