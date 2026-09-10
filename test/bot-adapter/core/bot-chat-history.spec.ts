import { BotChatHistoryService } from '@/modules/bot-adapter/core/application/message/bot-chat-history.service';

const message = {
  selfId: 'qq-official:1',
  connectionMode: 'official-websocket',
  messageType: 'group',
  targetId: 'group-a',
  userId: 'alice',
  messageId: 'current',
  messageText: '之前谁提到的？',
  rawMessage: '',
  rawEvent: {},
  eventTime: new Date('2026-09-10T10:00:00Z'),
} as const;

describe('Bound group history', () => {
  const builder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const repository = {
    createQueryBuilder: jest.fn(() => builder),
    findOne: jest.fn(),
  };
  const service = new BotChatHistoryService(repository as never);
  beforeEach(() => jest.clearAllMocks());

  it('keeps multiple senders and bot replies in chronological order with a stable page cursor', async () => {
    builder.getMany.mockResolvedValue([
      {
        id: '33',
        messageId: 'three',
        userId: 'bot',
        senderNickname: '塔塔露',
        direction: 'outbound',
        messageText: '刚才是小李说的',
        eventTime: message.eventTime,
      },
      {
        id: '32',
        messageId: 'two',
        userId: 'bob',
        senderNickname: '小李',
        direction: 'inbound',
        messageText: '小鸣鼠',
        eventTime: message.eventTime,
      },
      {
        id: '31',
        messageId: 'one',
        userId: 'alice',
        direction: 'inbound',
        messageText: '好',
        eventTime: message.eventTime,
      },
    ]);
    const result = await service.read(message, {
      limit: 2,
      query: '鼠',
      targetId: 'forged',
    });
    expect(result.messages.map((item) => item.messageId)).toEqual([
      'two',
      'three',
    ]);
    expect(result.messages[0].sender).toMatchObject({
      platformId: 'bob',
      name: '小李',
    });
    expect(result.nextBeforeId).toBe('32');
    expect(builder.andWhere).toHaveBeenCalledWith(
      'message.targetId = :targetId',
      { targetId: 'group-a' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'message.eventTime <= :eventTime',
      { eventTime: message.eventTime },
    );
    expect(builder.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('userId'),
      expect.anything(),
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'LOCATE(:query, message.messageText) > 0',
      { query: '鼠' },
    );
  });

  it('refuses guessed members from a different group and invalid pagination', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.requireMember(message, 'guessed-qq')).rejects.toThrow(
      '未在当前会话',
    );
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetId: 'group-a',
          userId: 'guessed-qq',
          direction: 'inbound',
        }),
      }),
    );
    await expect(
      service.read(message, { beforeId: '1 OR 1=1' }),
    ).rejects.toThrow('参数');
  });

  it('bounds long history without losing the continuation cursor', async () => {
    builder.getMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        id: String(100 - i),
        messageId: String(100 - i),
        userId: 'bob',
        direction: 'inbound',
        messageText: '长'.repeat(5000),
        eventTime: message.eventTime,
      })),
    );
    const result = await service.read(message);
    expect(result.messages.length).toBeLessThan(10);
    expect(result.messages.every((item) => item.truncated)).toBe(true);
    expect(result.nextBeforeId).toBe(result.messages[0].rowId);
  });
});
