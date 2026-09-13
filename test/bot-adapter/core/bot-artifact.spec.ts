import { Readable } from 'node:stream';
import { BotArtifactService } from '@/modules/bot-adapter/core/application/message/bot-artifact.service';
import { assertGenericAssetBucket } from '@/modules/asset/domain/asset-private-bucket';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const message = {
  selfId: 'qq-official:test',
  messageType: 'group',
  targetId: 'group-a',
  userId: 'alice',
  messageId: 'picture-1',
  messageText: '',
  rawMessage: '',
  eventTime: new Date('2026-09-14T00:00:00Z'),
  rawEvent: {
    attachments: [
      {
        content_type: 'image/png',
        url: 'https://multimedia.nt.qq.com.cn/picture',
      },
    ],
  },
} as const;

describe('Private durable Bot image history', () => {
  const objects = new Map<string, Buffer>();
  const client = {
    bucketExists: jest.fn(async () => true),
    makeBucket: jest.fn(),
    getBucketPolicy: jest.fn(async () => ''),
    putObject: jest.fn(async (_bucket, key, bytes) => {
      objects.set(key, Buffer.from(bytes));
    }),
    statObject: jest.fn(async (_bucket, key) => {
      if (!objects.has(key))
        throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
      return { size: objects.get(key)!.length };
    }),
    getObject: jest.fn(async (_bucket, key) =>
      Readable.from([objects.get(key)!]),
    ),
  };
  const repository = { findOne: jest.fn() };
  const makeService = () =>
    new BotArtifactService({ client } as never, repository as never);
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    objects.clear();
    client.getBucketPolicy.mockResolvedValue('');
    repository.findOne.mockImplementation(async ({ where }) => {
      if (
        where.targetId === 'group-a' &&
        where.selfId === message.selfId &&
        where.messageId === message.messageId
      )
        return { ...message, senderNickname: 'Alice' };
      return null;
    });
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => new Response(png));
  });
  afterEach(() => fetchMock.mockRestore());

  it('reads identical bytes after source expiry and a new service instance, without fetching the source again', async () => {
    expect(await makeService().capture(message as never)).toHaveLength(1);
    fetchMock.mockRejectedValue(new Error('expired source URL'));
    const restarted = makeService();
    const result = await restarted.readImage(message as never, {
      messageId: 'picture-1',
      index: 0,
    });
    expect(result.data).toBe(png.toString('base64'));
    expect(result.sender).toBe('Alice');
    await restarted.capture(message as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not let an image identifier cross a group or account boundary', async () => {
    await makeService().capture(message as never);
    await expect(
      makeService().readImage({ ...message, targetId: 'other' } as never, {
        messageId: 'picture-1',
      }),
    ).rejects.toThrow('当前会话');
    await expect(
      makeService().readImage({ ...message, selfId: 'other' } as never, {
        messageId: 'picture-1',
      }),
    ).rejects.toThrow('当前会话');
  });
  it('detects corrupted storage bytes and refuses public bucket policies and generic downloads', async () => {
    const [stored] = await makeService().capture(message as never);
    objects.set(stored.key, Buffer.from('corrupt'));
    await expect(
      makeService().readImage(message as never, { messageId: 'picture-1' }),
    ).rejects.toThrow('完整性');
    client.getBucketPolicy.mockResolvedValue(
      '{"Statement":[{"Effect":"Allow"}]}',
    );
    await expect(makeService().capture(message as never)).rejects.toThrow(
      '公开策略',
    );
    expect(() => assertGenericAssetBucket('kt-bot-artifacts-private')).toThrow(
      '所属领域',
    );
  });
});
