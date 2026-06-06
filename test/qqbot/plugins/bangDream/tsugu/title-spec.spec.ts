import {
  BANGDREAM_TITLE_SPEC,
  createTitleTextDrawOptions,
  getTitleTextPosition,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/title-spec';
import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/theme';

describe('BangDream title spec', () => {
  it('keeps the historical title background offset stable', () => {
    expect(BANGDREAM_TITLE_SPEC.background).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('keeps the historical first and second title text layout stable', () => {
    expect(BANGDREAM_TITLE_SPEC.text.first).toEqual({
      color: BANGDREAM_RENDER_THEME.color.surface,
      font: BANGDREAM_RENDER_THEME.font.body,
      lineHeight: 50,
      maxWidth: 900,
      textSize: 30,
      x: 74,
      y: 0,
    });
    expect(BANGDREAM_TITLE_SPEC.text.second).toEqual({
      color: BANGDREAM_RENDER_THEME.color.labelBackground,
      font: BANGDREAM_RENDER_THEME.font.body,
      lineHeight: 68,
      maxWidth: 900,
      textSize: 40,
      x: 74,
      y: 42,
    });
  });

  it('creates title text draw options and positions from the shared spec', () => {
    expect(createTitleTextDrawOptions('查询', 'first')).toEqual({
      color: BANGDREAM_RENDER_THEME.color.surface,
      font: BANGDREAM_RENDER_THEME.font.body,
      lineHeight: 50,
      maxWidth: 900,
      text: '查询',
      textSize: 30,
    });
    expect(createTitleTextDrawOptions('卡牌', 'second')).toEqual({
      color: BANGDREAM_RENDER_THEME.color.labelBackground,
      font: BANGDREAM_RENDER_THEME.font.body,
      lineHeight: 68,
      maxWidth: 900,
      text: '卡牌',
      textSize: 40,
    });
    expect(getTitleTextPosition('first')).toEqual({ x: 74, y: 0 });
    expect(getTitleTextPosition('second')).toEqual({ x: 74, y: 42 });
  });
});
