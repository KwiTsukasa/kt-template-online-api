import { Chart, registerables } from 'chart.js';
import type { ChartConfiguration, ChartItem } from 'chart.js';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import 'chartjs-adapter-moment';
import { assetsRootPath } from '@/modules/plugins/bangdream/src/config/runtime-config';
import { assetErrorImageBuffer } from '@/modules/plugins/bangdream/src/theme/canvas-image';
import {
  BANGDREAM_TIMELINE_CHART_SPEC,
  getTimelineDisplayYMax,
  getTimelineRawYMax,
  type TimelineChartDataset,
  type TimelineChartPoint,
} from '@/modules/plugins/bangdream/src/domain/cutoff/timeline-chart.layout';

// 2. 注册 Chart.js 所有组件
Chart.register(...registerables);

// 3. 强制使用 `basic` platform，避免 DOM 相关错误
// ChartJSNode.defaults.platform = 'basic';

// 4. 配置字体（如果有的话）
FontLibrary.use('old', [`${assetsRootPath}/Fonts/old.ttf`]);

// 5. 定义参数接口
interface DrawTimeLineChartOptions {
  start: Date;
  end: Date;
  setStartToZero?: boolean;
  data: {
    datasets: TimelineChartDataset[];
  };
}

// 6. 主函数：生成时间轴图表
/**
 * 根据`displayLabel`绘制或格式化时间文本行Chart；从受控资源来源加载所需数据（`loadImage`）。
 * @param displayLabel - 决定时间文本行Chart内容、边界或目标的 `displayLabel` 值；省略时默认采用 `false`。
 * @returns 时间文本行Chart。
 */
export async function drawTimeLineChart(
  { start, end, setStartToZero = false, data }: DrawTimeLineChartOptions,
  displayLabel = false,
) {
  const width = BANGDREAM_TIMELINE_CHART_SPEC.canvas.width;
  const height = BANGDREAM_TIMELINE_CHART_SPEC.canvas.height;

  // 7. 创建 skia-canvas 实例
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  // 8. 计算 y 轴最大值
  const yMax = getTimelineRawYMax(data.datasets);

  // 9. 配置 Chart.js 选项
  const options = {
    plugins: {
      legend: {
        labels: {
          font: {
            size: BANGDREAM_TIMELINE_CHART_SPEC.legend.fontSize,
          },
        },
        display: displayLabel,
      },
    },
    scales: {
      x: {
        type: 'time' as const,
        time: {
          unit: BANGDREAM_TIMELINE_CHART_SPEC.xAxis.unit,
        },
        min: start.getTime(),
        max: end.getTime(),
        display: !setStartToZero,
      },
      y: {
        min: BANGDREAM_TIMELINE_CHART_SPEC.yAxis.min,
        max: getTimelineDisplayYMax(yMax),
      },
    },
  };

  // 10. Chart.js 配置
  const config: ChartConfiguration<'line', TimelineChartPoint[]> = {
    type: 'line' as const,
    data,
    options: {
      ...options,
      responsive: BANGDREAM_TIMELINE_CHART_SPEC.responsive, // 重要：关闭 Chart.js 自适应模式
      animation: BANGDREAM_TIMELINE_CHART_SPEC.animation,
    },
  };

  try {
    // 11. 生成 Chart.js 图表
    new Chart(ctx as unknown as ChartItem, config);

    // 12. 返回 skia-canvas 的 Image 对象
    return canvas;
  } catch {
    return loadImage(assetErrorImageBuffer);
  }
}
