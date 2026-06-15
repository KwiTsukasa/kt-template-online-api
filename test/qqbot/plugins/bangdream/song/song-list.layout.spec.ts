import {
  BANGDREAM_SONG_LIST_SPEC,
  createSongInListLayout,
  getSongListCanvasHeight,
  getSongListContentWidth,
  getSongListFrameLineHeight,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-list.layout';

describe('BangDream song list spec', () => {
  it('keeps song list item dimensions stable', () => {
    const layout = createSongInListLayout({ height: 45, width: 270 });

    expect(layout).toEqual({
      canvasHeight: 75,
      canvasWidth: 800,
      difficultyX: 530,
      difficultyY: 15,
      idTextX: 0,
      idTextY: 0,
      jacketHeight: 65,
      jacketSourceHeightMax: 80,
      jacketSourceWidthMax: 80,
      jacketWidth: 65,
      jacketX: 50,
      jacketY: 5,
      textLineHeight: 37.5,
      textMaxWidth: 800,
      textSize: 23,
      titleTextX: 120,
      titleTextY: 0,
    });
  });

  it('centers the difficulty image vertically for the row height', () => {
    expect(createSongInListLayout({ height: 30, width: 100 }).difficultyY).toBe(
      22.5,
    );
  });

  it('keeps song list group dimensions stable', () => {
    expect(BANGDREAM_SONG_LIST_SPEC.list.key).toBe('歌榜歌曲');
    expect(getSongListContentWidth()).toBe(760);
    expect(getSongListCanvasHeight(3)).toBe(245);
    expect(getSongListFrameLineHeight(245)).toBe(265);
  });
});
