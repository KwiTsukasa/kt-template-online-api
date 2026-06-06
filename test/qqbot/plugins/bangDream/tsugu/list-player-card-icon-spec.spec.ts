import {
  BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC,
  getPlayerCardIconListSpacing,
  getPlayerCardIconListTextSize,
  sortPlayerMainDeckEntries,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-player-card-icon-spec';

describe('BangDream player card icon list spec', () => {
  it('keeps player card list text and spacing ratios stable', () => {
    const lineHeight =
      BANGDREAM_PLAYER_CARD_ICON_LIST_SPEC.list.defaultLineHeight;

    expect(lineHeight).toBe(184);
    expect(getPlayerCardIconListTextSize(lineHeight)).toBe(165.6);
    expect(getPlayerCardIconListSpacing(lineHeight)).toBe(11.96);
  });

  it('keeps historical player deck display order', () => {
    expect(sortPlayerMainDeckEntries(['0', '1', '2', '3', '4'])).toEqual([
      '3',
      '1',
      '0',
      '2',
      '4',
    ]);
  });

  it('skips missing deck entries without changing the remaining order', () => {
    expect(sortPlayerMainDeckEntries(['0', '1', '2'])).toEqual([
      '1',
      '0',
      '2',
    ]);
  });
});
