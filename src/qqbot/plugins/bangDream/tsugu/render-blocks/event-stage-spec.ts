export interface EventStageCanvasLike {
  height: number;
}

export const BANGDREAM_EVENT_STAGE_SPEC = {
  list: {
    maxColumnHeight: 6000,
  },
  songRow: {
    difficultyHeightScale: 10,
    jacketInsetX: 3,
    jacketY: 0,
    songCountPerRow: 8,
    songId: {
      color: '#a7a7a7',
      fontSize: 16,
      x: 4,
      y: 108,
    },
    verticalPadding: 10,
    width: 800,
  },
  typeTop: {
    fontSize: 25,
    rightPadding: 50,
    strokeWidth: 4.5,
    textColor: '#ffffff',
    textX: 20,
    yOffset: -2,
  },
} as const;

/**
 * 获取试炼歌曲单元格宽度。
 */
export function getEventStageSongCellWidth(): number {
  return (
    BANGDREAM_EVENT_STAGE_SPEC.songRow.width /
    BANGDREAM_EVENT_STAGE_SPEC.songRow.songCountPerRow
  );
}

/**
 * 获取试炼歌曲封面绘制高度。
 */
export function getEventStageSongJacketHeight(): number {
  return getEventStageSongCellWidth() - 6;
}

/**
 * 获取试炼歌曲单元格高度。
 */
export function getEventStageSongCellHeight(): number {
  return (getEventStageSongCellWidth() / 180) * 210;
}

/**
 * 获取试炼歌曲横向行尺寸。
 */
export function getEventStageSongRowSize(): { height: number; width: number } {
  return {
    height:
      getEventStageSongCellHeight() +
      BANGDREAM_EVENT_STAGE_SPEC.songRow.verticalPadding,
    width: BANGDREAM_EVENT_STAGE_SPEC.songRow.width,
  };
}

/**
 * 将试炼 stage 图片按最大列高拆成多列。
 *
 * @param images - 试炼 stage 图片列表。
 * @param maxHeight - 单列最大高度，未传入时使用默认值。
 */
export function splitEventStageImagesByColumnHeight<
  T extends EventStageCanvasLike,
>(
  images: T[],
  maxHeight = BANGDREAM_EVENT_STAGE_SPEC.list.maxColumnHeight,
): T[][] {
  const columns: T[][] = [];
  let currentColumn: T[] = [];
  let currentHeight = 0;

  for (const image of images) {
    currentHeight += image.height;
    if (currentHeight > maxHeight && currentColumn.length > 0) {
      columns.push(currentColumn);
      currentColumn = [];
      currentHeight = image.height;
    }
    currentColumn.push(image);
  }

  if (currentColumn.length > 0) {
    columns.push(currentColumn);
  }

  return columns;
}
