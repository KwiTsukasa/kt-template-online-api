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
 * 根据当前领域状态，获取试炼歌曲单元格宽度。
 * @returns 根据当前领域状态，获取试炼歌曲单元格宽度。
 */
export function getEventStageSongCellWidth(): number {
  return (
    BANGDREAM_EVENT_STAGE_SPEC.songRow.width /
    BANGDREAM_EVENT_STAGE_SPEC.songRow.songCountPerRow
  );
}

/**
 * 根据当前领域状态，获取试炼歌曲封面绘制高度。
 * @returns 根据当前领域状态，获取试炼歌曲封面绘制高度。
 */
export function getEventStageSongJacketHeight(): number {
  return getEventStageSongCellWidth() - 6;
}

/**
 * 根据当前领域状态，获取试炼歌曲单元格高度。
 * @returns 根据当前领域状态，获取试炼歌曲单元格高度。
 */
export function getEventStageSongCellHeight(): number {
  return (getEventStageSongCellWidth() / 180) * 210;
}

/**
 * 根据当前领域状态，获取试炼歌曲横向行尺寸。
 * @returns 包含 `height`、`width` 字段的根据当前领域状态，获取试炼歌曲横向行尺寸。
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
 * 根据当前领域状态，获取试炼 stage 绘制批大小。
 * @returns 根据当前领域状态，获取试炼 stage 绘制批大小。
 */
export function getEventStageStageBatchSize(): number {
  return BANGDREAM_EVENT_STAGE_SPEC.list.stageBatchSize;
}

/**
 * 根据当前列占用与下一张试炼图尺寸判断是否切换到新列。
 * @param currentHeight - 决定根据当前列占用与下一张试炼图尺寸判断是否切换到新列内容、边界或目标的 `currentHeight` 值。
 * @param nextImageHeight - 决定根据当前列占用与下一张试炼图尺寸判断是否切换到新列内容、边界或目标的 `nextImageHeight` 值。
 * @param currentColumnLength - 限制根据当前列占用与下一张试炼图尺寸判断是否切换到新列数量、尺寸、等级或重试边界的数值。
 * @param maxHeight - 决定根据当前列占用与下一张试炼图尺寸判断是否切换到新列内容、边界或目标的 `maxHeight` 值；省略时默认采用 `BANGDREAM_EVENT_STAGE_SPEC.list.maxColumnHeight`。
 * @returns 满足根据当前列占用与下一张试炼图尺寸判断是否切换到新列约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * @param images - 决定将试炼 stage 图片按最大列高拆成多列内容、边界或目标的 `images` 值。
 * @param maxHeight - 决定将试炼 stage 图片按最大列高拆成多列内容、边界或目标的 `maxHeight` 值；省略时默认采用 `BANGDREAM_EVENT_STAGE_SPEC.list.maxColumnHeight`。
 * @returns 按输入顺序得到的将试炼 stage 图片按最大列高拆成多列列表；没有匹配项时为空数组。
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
