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
 * 计算角色详情头像缩放参数，并输出固定投影 `widthMax` 字段。
 * @returns 包含 `widthMax` 字段的角色详情图标布局规格。
 */
export function createCharacterDetailIconSpec() {
  return {
    widthMax: BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.item.iconWidth,
  };
}

/**
 * 计算角色详情正文绘制参数，并输出固定投影 `lineHeight`、`maxWidth` 字段。
 * @returns 包含 `lineHeight`、`maxWidth` 字段的角色详情文本布局规格。
 */
export function createCharacterDetailTextSpec() {
  const item = BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.item;
  return {
    lineHeight: item.textLineHeight,
    maxWidth: item.width,
  };
}

/**
 * 计算角色详情项画布和内容位置，并输出固定投影 `canvasHeight`、`canvasWidth`、`iconX`、`iconY`、`textX` 字段。
 * @param contentImage - 用于角色详情条目布局的领域对象，包含 `width` 字段。
 * @returns 包含 `canvasHeight`、`canvasWidth`、`iconX`、`iconY`、`textX` 字段的角色详情条目布局。
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
 * 计算角色详情列表传给通用列表框架的尺寸，并输出固定投影 `lineHeight`、`spacing`、`textSize` 字段。
 * @param firstItem - 用于角色详情边框布局规格的领域对象，包含 `height` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 包含 `lineHeight`、`spacing`、`textSize` 字段的角色详情边框布局规格。
 */
export function createCharacterDetailListFrameSpec(firstItem?: ImageLike) {
  return {
    lineHeight: firstItem?.height,
    spacing: BANGDREAM_CHARACTER_DETAIL_LIST_SPEC.list.spacing,
    textSize: firstItem?.height,
  };
}
