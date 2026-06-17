interface ImageLike {
  height: number;
  width: number;
}

export const BANGDREAM_CHARACTER_DETAIL_LIST_SPEC = {
  item: {
    height: 100,
    iconWidth: 50,
    textLineHeight: 40,
    textOffsetY: 50,
    width: 76,
  },
  list: {
    spacing: 0,
  },
} as const;

/**
 * 计算角色详情头像缩放参数。
 */
export function createCharacterDetailIconSpec() {
  return {
    widthMax: BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.item.iconWidth,
  };
}

/**
 * 计算角色详情正文绘制参数。
 */
export function createCharacterDetailTextSpec() {
  const item = BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.item;
  return {
    lineHeight: item.textLineHeight,
    maxWidth: item.width,
  };
}

/**
 * 计算角色详情项画布和内容位置。
 *
 * @param contentImage - contentImage 输入；使用 `width` 字段生成结果。
 */
export function createCharacterDetailItemLayout(contentImage: ImageLike) {
  const item = BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.item;
  return {
    canvasHeight: item.height,
    canvasWidth: item.width,
    iconX: (item.width - item.iconWidth) / 2,
    iconY: 0,
    textX: item.width / 2 - contentImage.width / 2,
    textY: item.textOffsetY,
  };
}

/**
 * 计算角色详情列表传给通用列表框架的尺寸。
 *
 * @param firstItem - firstItem 输入；生成 BangDream对象。
 */
export function createCharacterDetailListFrameSpec(firstItem?: ImageLike) {
  return {
    lineHeight: firstItem?.height,
    spacing: BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.list.spacing,
    textSize: firstItem?.height,
  };
}
