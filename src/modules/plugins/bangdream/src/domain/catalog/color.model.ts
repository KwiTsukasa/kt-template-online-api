import { Canvas } from 'skia-canvas';

export class Color {
  r: number;
  g: number;
  b: number;
  constructor(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
  /**
   * 将当前 RGB 分量与透明度拼接为 CSS `rgba(...)` 颜色字符串。
   * @param alpha - 颜色透明度；省略时使用完全不透明的 `1`。
   * @returns 包含当前红、绿、蓝分量和指定透明度的 CSS RGBA 字符串。
   */
  getRGBA(alpha = 1): string {
    return `rgba(${this.r},${this.g},${this.b}, ${alpha})`;
  }

  /**
   * 在 Color 模型中设置RGB，并会更新 `this.r`、`this.g`、`this.b`。
   * @param r - `r` 写入 `this.r` 状态。
   * @param g - `g` 写入 `this.g` 状态。
   * @param b - `b` 写入 `this.b` 状态。
   */
  setRGB(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  /**
   * 通过在 Color 模型中生成颜色块。
   * @param alpha - 决定通过在 Color 模型中生成颜色块内容、边界或目标的 `alpha` 值；省略时默认采用 `1`。
   * @returns 通过在 Color 模型中生成颜色块。
   */
  generateColorBlock(alpha = 1): Canvas {
    const colorCanvas = new Canvas(50, 50);
    const colorCtx = colorCanvas.getContext('2d');
    colorCtx.fillStyle = this.getRGBA(alpha);
    colorCtx.fillRect(0, 0, 50, 50);
    return colorCanvas;
  }
}

//getcolorfrom #xxxxxx
/**
 * 按`hex`读取颜色十六进制颜色。
 * @param hex - 决定颜色十六进制颜色内容、边界或目标的 `hex` 值。
 * @returns 颜色十六进制颜色。
 */
export function getColorFromHex(hex: string): Color {
  const color = new Color(
    parseInt(hex.substring(1, 3), 16),
    parseInt(hex.substring(3, 5), 16),
    parseInt(hex.substring(5, 7), 16),
  );
  return color;
}

//用于图表的随机颜色
const presetColorList = [
  { r: 254, g: 65, b: 111 }, // 玫瑰红
  { r: 179, g: 49, b: 255 }, // 紫色
  { r: 64, g: 87, b: 227 }, // 宝石蓝
  { r: 68, g: 197, b: 39 }, // 草绿色
  { r: 255, g: 255, b: 81 }, // 柠檬黄
  { r: 0, g: 132, b: 255 }, // 天蓝色
  { r: 240, g: 128, b: 128 }, // 浅珊瑚色
  { r: 60, g: 179, b: 113 }, // 春绿色
  { r: 255, g: 165, b: 0 }, // 橙色
  { r: 106, g: 90, b: 205 }, // 石蓝色
];

/**
 * 根据当前运行态处理包含 `r`、`g`、`b` 字段的结果。
 * @returns 包含 `r`、`g`、`b` 字段的包含 `r`、`g`、`b` 字段的。
 */
function randomRGB(): { r: number; g: number; b: number } {
  /**
   * 返回从 `0` 到 `254` 的随机整数，用于生成 RGB 颜色分量。
   * @returns 从 `0` 到 `254` 的随机整数，用于生成 RGB 颜色分量。
   */
  function generateNumber255() {
    return Math.floor(Math.random() * 255);
  }
  return {
    r: generateNumber255(),
    g: generateNumber255(),
    b: generateNumber255(),
  };
}

/**
 * 按索引选择图表预设色，未提供索引或超过预设列表上界时改用随机 RGB 颜色。
 * @param index - 预设颜色列表的非负零基索引；省略或不小于列表长度时生成随机颜色。
 * @returns 由选中预设值或随机 RGB 分量初始化的颜色对象。
 */
export function getPresetColor(index?: number): Color {
  let tempColor: { r: number; g: number; b: number };
  if (index == undefined) {
    tempColor = randomRGB();
  } else if (index < presetColorList.length) {
    tempColor = presetColorList[index];
  } else {
    // 当索引超过预定义颜色列表长度时，生成随机颜色
    tempColor = randomRGB();
  }
  return new Color(tempColor.r, tempColor.g, tempColor.b);
}
