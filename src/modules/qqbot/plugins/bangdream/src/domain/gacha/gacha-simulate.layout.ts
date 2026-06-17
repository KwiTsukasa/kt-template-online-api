export interface GachaSimulateRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface GachaSimulatePoint {
  x: number;
  y: number;
}

export const BANGDREAM_GACHA_SIMULATE_SPEC = {
  banner: {
    extraWidth: 200,
    imageX: 50,
    imageY: 0,
    maxWidthRatio: 1 / 2,
  },
  card: {
    canvas: { height: 230, width: 230 },
    countText: {
      color: '#A7A7A7',
      maxWidth: 80,
      rightX: 215,
      textSize: 30,
      y: 195,
    },
    duplicateIcon: {
      height: 180,
      maxLayerCount: 6,
      offsetStep: 4,
      width: 180,
      x: 35,
      y: 20,
    },
    iconSingle: { height: 200, width: 180, x: 35, y: 20 },
    iconWithCount: { height: 210, width: 180, x: 35, y: 20 },
  },
  grid: {
    columns: 5,
    single: { lineHeight: 230, textSize: 230 },
    spacing: 0,
    summary: { lineHeight: 115, textSize: 115 },
  },
} as const;

/**
 * 获取抽卡结果网格最大宽度。
 */
export function getGachaSimulateGridMaxWidth(): number {
  return (
    BANGDREAM_GACHA_SIMULATE_SPEC.card.canvas.width *
    BANGDREAM_GACHA_SIMULATE_SPEC.grid.columns
  );
}

/**
 * 创建抽卡结果图片混排参数。
 *
 * @param mode - mode 输入；生成 BangDream对象。
 */
export function createGachaSimulateWrapOptions(mode: 'single' | 'summary'): {
  lineHeight: number;
  maxWidth: number;
  spacing: number;
  textSize: number;
} {
  const sizeSpec = BANGDREAM_GACHA_SIMULATE_SPEC.grid[mode];
  return {
    lineHeight: sizeSpec.lineHeight,
    maxWidth: getGachaSimulateGridMaxWidth(),
    spacing: BANGDREAM_GACHA_SIMULATE_SPEC.grid.spacing,
    textSize: sizeSpec.textSize,
  };
}

/**
 * 计算重复卡牌阴影层数。
 *
 * @param numberOfCard - numberOfCard 输入；驱动 `Math.min()` 的 BangDream步骤。
 */
export function getGachaDuplicateLayerCount(numberOfCard: number): number {
  return Math.min(
    BANGDREAM_GACHA_SIMULATE_SPEC.card.duplicateIcon.maxLayerCount,
    Math.max(0, numberOfCard - 1),
  );
}

/**
 * 计算重复卡牌阴影层绘制区域。
 *
 * @param layerIndex - layerIndex 输入；限定 BangDream查询范围。
 * @param layerCount - layerCount 输入；限定 BangDream查询范围。
 */
export function getGachaDuplicateIconRect(
  layerIndex: number,
  layerCount: number,
): GachaSimulateRect {
  const duplicateSpec = BANGDREAM_GACHA_SIMULATE_SPEC.card.duplicateIcon;
  const offset = (layerCount - layerIndex) * duplicateSpec.offsetStep;
  return {
    height: duplicateSpec.height,
    width: duplicateSpec.width,
    x: duplicateSpec.x - offset,
    y: duplicateSpec.y - offset,
  };
}

/**
 * 根据计数字样宽度计算右对齐绘制位置。
 *
 * @param textWidth - textWidth 输入；限定 BangDream查询范围。
 */
export function getGachaCountTextPosition(
  textWidth: number,
): GachaSimulatePoint {
  return {
    x: BANGDREAM_GACHA_SIMULATE_SPEC.card.countText.rightX - textWidth,
    y: BANGDREAM_GACHA_SIMULATE_SPEC.card.countText.y,
  };
}

/**
 * 获取抽卡横幅最大内容宽度。
 */
export function getGachaBannerImageMaxWidth(): number {
  return (
    getGachaSimulateGridMaxWidth() *
    BANGDREAM_GACHA_SIMULATE_SPEC.banner.maxWidthRatio
  );
}

/**
 * 根据横幅内容高度计算外层画布尺寸。
 *
 * @param imageHeight - imageHeight 输入；生成 BangDream对象。
 */
export function createGachaBannerCanvasSize(imageHeight: number): {
  height: number;
  width: number;
} {
  return {
    height: imageHeight,
    width:
      getGachaSimulateGridMaxWidth() +
      BANGDREAM_GACHA_SIMULATE_SPEC.banner.extraWidth,
  };
}
