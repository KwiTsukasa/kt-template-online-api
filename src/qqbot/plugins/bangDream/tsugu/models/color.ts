import { Canvas } from 'skia-canvas';

export class Color {
  r: number;
  g: number;
  b: number;
  /**
   * 构造 Color 实例，并初始化该模型的本地基础字段。
   *
   * @param r - r参数。
   * @param g - g参数。
   * @param b - b参数。
   */
  constructor(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
  /**
   * 在 Color 模型中获取RGBA。
   *
   * @param alpha - alpha参数，未传入时使用默认值。
   * @returns 格式化后的文本。
   */
  getRGBA(alpha = 1): string {
    return `rgba(${this.r},${this.g},${this.b}, ${alpha})`;
  }

  /**
   * 在 Color 模型中设置RGB。
   *
   * @param r - r参数。
   * @param g - g参数。
   * @param b - b参数。
   */
  setRGB(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  /**
   * 在 Color 模型中生成颜色块。
   *
   * @param alpha - alpha参数，未传入时使用默认值。
   * @returns 渲染或资源结果。
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
 * 在BangDream 领域模型层中获取颜色FromHex。
 *
 * @param hex - hex参数。
 * @returns 处理结果。
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
 * 在BangDream 领域模型层中处理randomRGB。
 *
 * @returns 计算后的数值。
 */
function randomRGB(): { r: number; g: number; b: number } {
  /**
   * 在BangDream 领域模型层中生成Number255。
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
 * 在BangDream 领域模型层中获取Preset颜色。
 *
 * @param index - 当前列表下标，未传入时使用默认值。
 * @returns 处理结果。
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
