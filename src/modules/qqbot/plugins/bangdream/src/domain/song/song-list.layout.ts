import { getListFrameTextMaxWidth } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.layout';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';

interface ImageLike {
  height: number;
  width: number;
}

export const BANGDREAM_SONG_LIST_SPEC = {
  item: {
    canvasHeight: 75,
    difficultyHeight: 45,
    difficultySpacing: 10,
    idTextX: 0,
    idTextY: 0,
    jacketHeight: 65,
    jacketSourceHeightMax: 80,
    jacketSourceWidthMax: 80,
    jacketWidth: 65,
    jacketX: 50,
    jacketY: 5,
    textLineHeight: 37.5,
    textSize: 23,
    titleTextX: 120,
    titleTextY: 0,
  },
  list: {
    key: '歌榜歌曲',
    lineHeightPadding: 20,
    separatorHeight: 10,
    spacing: 0,
  },
} as const;

/**
 * 计算歌曲列表单行布局。
 *
 * @param difficultyImage - difficultyImage 输入；使用 `width`、`height` 字段生成结果。
 * @param contentWidth - contentWidth 输入；生成 BangDream对象。
 */
export function createSongInListLayout(
  difficultyImage: ImageLike,
  contentWidth: number = BANGDREAM_RENDER_THEME.layout.contentWidth,
) {
  const item = BANGDREAM_SONG_LIST_SPEC.item;
  return {
    canvasHeight: item.canvasHeight,
    canvasWidth: contentWidth,
    difficultyX: contentWidth - difficultyImage.width,
    difficultyY: item.canvasHeight / 2 - difficultyImage.height / 2,
    idTextX: item.idTextX,
    idTextY: item.idTextY,
    jacketHeight: item.jacketHeight,
    jacketSourceHeightMax: item.jacketSourceHeightMax,
    jacketSourceWidthMax: item.jacketSourceWidthMax,
    jacketWidth: item.jacketWidth,
    jacketX: item.jacketX,
    jacketY: item.jacketY,
    textLineHeight: item.textLineHeight,
    textMaxWidth: contentWidth,
    textSize: item.textSize,
    titleTextX: item.titleTextX,
    titleTextY: item.titleTextY,
  };
}

/**
 * 获取歌曲列表内容宽度。
 */
export function getSongListContentWidth() {
  return getListFrameTextMaxWidth(BANGDREAM_RENDER_THEME.layout.contentWidth);
}

/**
 * 计算歌曲列表组画布高度。
 *
 * @param songCount - songCount 输入；限定 BangDream查询范围。
 */
export function getSongListCanvasHeight(songCount: number) {
  const { item, list } = BANGDREAM_SONG_LIST_SPEC;
  return item.canvasHeight * songCount + list.separatorHeight * (songCount - 1);
}

/**
 * 计算歌曲列表外层行高。
 *
 * @param canvasHeight - canvasHeight 输入；限定 BangDream查询范围。
 */
export function getSongListFrameLineHeight(canvasHeight: number) {
  return canvasHeight + BANGDREAM_SONG_LIST_SPEC.list.lineHeightPadding;
}
