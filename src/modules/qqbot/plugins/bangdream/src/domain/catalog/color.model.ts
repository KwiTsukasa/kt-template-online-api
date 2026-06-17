import { Canvas } from 'skia-canvas';

export class Color {
  r: number;
  g: number;
  b: number;
  /**
   * 构造 Color 实例，并初始化该模型的本地基础字段。
   *
   * @param r - r 输入；影响 constructor 的返回值。
   * @param g - g 输入；影响 constructor 的返回值。
   * @param b - b 输入；影响 constructor 的返回值。
   */
  constructor(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
  /**
   * 查询 BangDream 插件数据。
   *
   * @param alpha - alpha 输入；限定 BangDream查询范围。
   * @returns 格式化后的文本。
   */
  getRGBA(alpha = 1): string {
    return `rgba(${this.r},${this.g},${this.b}, ${alpha})`;
  }

  /**
   * 在 Color 模型中设置RGB。
   *
   * @param r - r 输入；写入 BangDream状态。
   * @param g - g 输入；写入 BangDream状态。
   * @param b - b 输入；写入 BangDream状态。
   */
  setRGB(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  /**
   * 在 Color 模型中生成颜色块。
   *
   * @param alpha - alpha 输入；驱动 `this.getRGBA()` 的 BangDream步骤。
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
 * @param hex - hex 输入；执行 `hex.substring()` 对应的 BangDream步骤。
 * @returns BangDream 插件查询结果。
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
 * 查询 BangDream 插件数据。
 *
 * @param index - index 输入；决定 BangDream条件分支。
 * @returns BangDream 插件查询结果。
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
