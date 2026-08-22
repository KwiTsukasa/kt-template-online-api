export interface CardSdCharacterCropRect {
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
}

export const BANGDREAM_CARD_SD_CHARACTER_SPEC = {
  sprite: {
    columns: 2,
    rows: 2,
    cropOffsetY: 84,
    cropWidth: 400,
    cropHeight: 470,
  },
  list: {
    targetWidth: 190,
    spacing: 0,
  },
} as const;

/**
 * 根据参数 `index`，计算卡牌 SD 角色 sprite 裁切区域。
 * @param index - 指定根据参数 `index`，计算卡牌 SD 角色 sprite 裁切区域在集合或布局中的零基位置。
 * @returns 包含 `sourceX`、`sourceY`、`width`、`height` 字段的根据参数 `index`，计算卡牌 SD 角色 sprite 裁切区域。
 */
export function getCardSdCharacterCropRect(
  index: number,
): CardSdCharacterCropRect {
  const { columns, cropHeight, cropOffsetY, cropWidth } =
    BANGDREAM_CARD_SD_CHARACTER_SPEC.sprite;

  return {
    sourceX: (index % columns) * cropWidth,
    sourceY: cropOffsetY + Math.floor(index / columns) * cropHeight,
    width: cropWidth,
    height: cropHeight,
  };
}

/**
 * 根据当前领域状态，生成卡牌 SD 角色列表需要展示的全部裁切区域。
 * @returns 按输入顺序得到的根据当前领域状态，生成卡牌 SD 角色列表需要展示的全部裁切区域列表；没有匹配项时为空数组。
 */
export function getCardSdCharacterCropRects(): CardSdCharacterCropRect[] {
  const { columns, rows } = BANGDREAM_CARD_SD_CHARACTER_SPEC.sprite;

  return Array.from({ length: columns * rows }, (_, index) =>
    getCardSdCharacterCropRect(index),
  );
}

/**
 * 按当前运行态读取卡牌 SD 角色列表展示行高。
 * @returns 卡牌 SD 角色列表展示行高。
 */
export function getCardSdCharacterListLineHeight() {
  const { cropHeight, cropWidth } = BANGDREAM_CARD_SD_CHARACTER_SPEC.sprite;
  const { targetWidth } = BANGDREAM_CARD_SD_CHARACTER_SPEC.list;

  return (cropHeight / cropWidth) * targetWidth;
}

/**
 * 将卡牌 SD 角色列表行高直接用作展示字号，使文字与单元格保持同一尺寸基准。
 * @returns 卡牌Sd角色文本Size。
 */
export function getCardSdCharacterListTextSize() {
  return getCardSdCharacterListLineHeight();
}
