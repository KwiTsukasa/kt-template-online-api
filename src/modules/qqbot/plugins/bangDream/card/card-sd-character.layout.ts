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
 * 计算卡牌 SD 角色 sprite 裁切区域。
 *
 * @param index - 第几个 SD 动作帧。
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
 * 生成卡牌 SD 角色列表需要展示的全部裁切区域。
 */
export function getCardSdCharacterCropRects(): CardSdCharacterCropRect[] {
  const { columns, rows } = BANGDREAM_CARD_SD_CHARACTER_SPEC.sprite;

  return Array.from({ length: columns * rows }, (_, index) =>
    getCardSdCharacterCropRect(index),
  );
}

/**
 * 计算卡牌 SD 角色列表展示行高。
 */
export function getCardSdCharacterListLineHeight() {
  const { cropHeight, cropWidth } = BANGDREAM_CARD_SD_CHARACTER_SPEC.sprite;
  const { targetWidth } = BANGDREAM_CARD_SD_CHARACTER_SPEC.list;

  return (cropHeight / cropWidth) * targetWidth;
}

/**
 * 计算卡牌 SD 角色列表展示字号。
 */
export function getCardSdCharacterListTextSize() {
  return getCardSdCharacterListLineHeight();
}
