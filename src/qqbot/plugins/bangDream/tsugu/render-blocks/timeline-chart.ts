import { Chart, registerables } from 'chart.js';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import 'chartjs-adapter-moment';
import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { assetErrorImageBuffer } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';
import {
  BANGDREAM_TIMELINE_CHART_SPEC,
  getTimelineDisplayYMax,
  getTimelineRawYMax,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/timeline-chart-spec';

// 2. 注册 Chart.js 所有组件
Chart.register(...registerables);

// 3. 强制使用 `basic` platform，避免 DOM 相关错误
// ChartJSNode.defaults.platform = 'basic';

// 4. 配置字体（如果有的话）
FontLibrary.use('old', [`${assetsRootPath}/Fonts/old.ttf`]);

// 5. 定义参数接口
interface drawTimeLineChartOptions {
  start: Date;
  end: Date;
  setStartToZero?: boolean;
  data: {
    datasets: any[];
  };
}

// 6. 主函数：生成时间轴图表
/**
 * 在图片布局层中绘制时间线条谱面。
 *
 * @param options1 - options1参数。
 * @param displayLabel - 展示Label参数，未传入时使用默认值。
 */
export async function drawTimeLineChart(
  { start, end, setStartToZero = false, data }: drawTimeLineChartOptions,
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
        type: 'time',
        time: {
          unit: BANGDREAM_TIMELINE_CHART_SPEC.xAxis.unit,
        },
        min: start,
        max: end,
        display: !setStartToZero,
      },
      y: {
        min: BANGDREAM_TIMELINE_CHART_SPEC.yAxis.min,
        max: getTimelineDisplayYMax(yMax),
      },
    },
  };

  // 10. Chart.js 配置
  const config = {
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
    new Chart(ctx as any, config as any);

    // 12. 返回 skia-canvas 的 Image 对象
    return canvas;
  } catch {
    return loadImage(assetErrorImageBuffer);
  }
}
