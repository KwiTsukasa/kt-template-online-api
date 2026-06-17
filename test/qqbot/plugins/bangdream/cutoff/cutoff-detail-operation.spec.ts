jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-detail.renderer',
  () => ({
    drawCutoffDetail: jest.fn().mockResolvedValue([Buffer.from('cutoff')]),
  }),
);

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.renderer',
  () => ({
    drawCutoffEventTop: jest.fn().mockResolvedValue([Buffer.from('top')]),
  }),
);

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model',
  () => ({
    getPresentEvent: jest.fn(() => ({ eventId: 321 })),
  }),
);

import { drawCutoffDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-detail.renderer';
import { cutoffDetailOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/cutoff-detail';

/**
 * 创建 BangDream 插件对象或配置。
 */
const createContext = () =>
  ({
    firstNumber: jest.fn((tokens: string[]) =>
      tokens.map((item) => Number(item)).find((item) => Number.isInteger(item)),
    ),
    getRenderOptions: jest.fn(() => ({ compress: true })),
    getTokens: jest.fn((input: { text?: string }) =>
      `${input.text || ''}`.trim().split(/\s+/).filter(Boolean),
    ),
    optionalNumber: jest.fn((value: unknown) => {
      if (value === undefined || value === null || value === '')
        return undefined;
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : undefined;
    }),
    pickMainServer: jest.fn(() => 0),
    toImageReply: jest.fn((operationKey, query, images) => ({
      imageCount: images.length,
      operationKey,
      query,
      replyText: '[CQ:image,file=base64://Y3V0b2Zm]',
      source: 'BangDream 内置插件',
    })),
  }) as any;

describe('BangDream cutoff detail operation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts the ycx command alias as a full smoke text with default tier', async () => {
    const context = createContext();

    await expect(
      cutoffDetailOperation.execute({ text: 'ycx' }, context),
    ).resolves.toMatchObject({
      operationKey: 'bangdream.cutoff.detail',
      query: '1000 321',
    });

    expect(drawCutoffDetail).toHaveBeenCalledWith(321, 1000, 0, true);
  });

  it('keeps explicit tier and event id after the ycx alias', async () => {
    const context = createContext();

    await expect(
      cutoffDetailOperation.execute({ text: 'ycx 2000 400' }, context),
    ).resolves.toMatchObject({
      query: '2000 400',
    });

    expect(drawCutoffDetail).toHaveBeenCalledWith(400, 2000, 0, true);
  });
});
