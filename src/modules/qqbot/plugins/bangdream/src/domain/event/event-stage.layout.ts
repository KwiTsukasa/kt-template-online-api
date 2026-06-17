export interface EventStageCanvasLike {
  height: number;
}

export const BANGDREAM_EVENT_STAGE_SPEC = {
  list: {
    maxColumnHeight: 6000,
    stageBatchSize: 8,
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
 * 获取试炼 stage 绘制批大小。
 */
export function getEventStageStageBatchSize(): number {
  return BANGDREAM_EVENT_STAGE_SPEC.list.stageBatchSize;
}

/**
 * 判断下一张试炼 stage 图是否应该换到新列。
 *
 * @param currentHeight - currentHeight 输入；计算 BangDream判断结果。
 * @param nextImageHeight - nextImageHeight 输入；计算 BangDream判断结果。
 * @param currentColumnLength - currentColumnLength 输入；计算 BangDream判断结果。
 * @param maxHeight - maxHeight 输入；计算 BangDream判断结果。
 */
export function shouldStartNewEventStageColumn(
  currentHeight: number,
  nextImageHeight: number,
  currentColumnLength: number,
  maxHeight = BANGDREAM_EVENT_STAGE_SPEC.list.maxColumnHeight,
): boolean {
  return currentColumnLength > 0 && currentHeight + nextImageHeight > maxHeight;
}

/**
 * 将试炼 stage 图片按最大列高拆成多列。
 *
 * @param images - BangDream列表；驱动 `for()` 的 BangDream步骤。
 * @param maxHeight - maxHeight 输入；决定 BangDream条件分支。
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
    if (
      shouldStartNewEventStageColumn(
        currentHeight,
        image.height,
        currentColumn.length,
        maxHeight,
      )
    ) {
      columns.push(currentColumn);
      currentColumn = [];
      currentHeight = 0;
    }
    currentColumn.push(image);
    currentHeight += image.height;
  }

  if (currentColumn.length > 0) {
    columns.push(currentColumn);
  }

  return columns;
}
