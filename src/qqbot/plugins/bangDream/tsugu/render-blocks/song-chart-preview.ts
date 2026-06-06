import { Canvas, Image, loadImage } from 'skia-canvas';
import type { CanvasRenderingContext2D } from 'skia-canvas';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';
import {
  BangDreamLocalAssetKey,
  getBangDreamAssetPath,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/theme';
import {
  BANGDREAM_SONG_CHART_DIFFICULTY_COLORS,
  BANGDREAM_SONG_CHART_PREVIEW_SPEC,
  BestdoriNote,
  createSongChartPreviewModel,
  isSongChartCountLineNoteType,
  PreviewLayout,
  PreviewNote,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/song-chart-preview-spec';

interface BestdoriPreviewPayload {
  id: number;
  title?: string;
  artist?: string;
  author?: string;
  diff: string;
  level: number;
  cover: string | Buffer;
}

const NOTE_IMAGE_KEYS = [
  'Single',
  'SingleOff',
  'Flick',
  'FlickTop',
  'Skill',
  'Long',
  'Tick',
  'Sim',
  'LeftArrow',
  'LeftArrowEnd',
  'RightArrow',
  'RightArrowEnd',
] as const;
const NOTE_IMAGE_ASSET_KEYS: Record<
  (typeof NOTE_IMAGE_KEYS)[number],
  BangDreamLocalAssetKey
> = {
  Flick: 'songChartNoteFlick',
  FlickTop: 'songChartNoteFlickTop',
  LeftArrow: 'songChartNoteLeftArrow',
  LeftArrowEnd: 'songChartNoteLeftArrowEnd',
  Long: 'songChartNoteLong',
  RightArrow: 'songChartNoteRightArrow',
  RightArrowEnd: 'songChartNoteRightArrowEnd',
  Sim: 'songChartNoteSim',
  Single: 'songChartNoteSingle',
  SingleOff: 'songChartNoteSingleOff',
  Skill: 'songChartNoteSkill',
  Tick: 'songChartNoteTick',
};
/**
 * 在图片布局层中加载谱面预览所需音符贴图。
 *
 * @returns 异步处理结果。
 */
async function loadNoteImages(): Promise<Record<string, Image>> {
  const entries = await Promise.all(
    NOTE_IMAGE_KEYS.map(async (key) => [
      key,
      await loadImageFromPath(
        getBangDreamAssetPath(NOTE_IMAGE_ASSET_KEYS[key]),
      ),
    ]),
  );
  return Object.fromEntries(entries);
}

/**
 * 在图片布局层中加载谱面预览封面图。
 *
 * @param cover - cover参数。
 * @returns 异步处理结果。
 */
async function loadCoverImage(cover: string | Buffer): Promise<Image> {
  try {
    return await loadImage(cover);
  } catch {
    return await loadImageFromPath(getBangDreamAssetPath('songChartJacket'));
  }
}

/**
 * 在图片布局层中设置Adaptive文本Baseline。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param fontSize - fontSize参数。
 * @param y - 纵向绘制坐标。
 */
function setAdaptiveTextBaseline(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  fontSize: number,
  y: number,
): void {
  if (y <= fontSize / 2) {
    ctx.textBaseline = 'top';
  } else if (y >= layout.height - fontSize / 2) {
    ctx.textBaseline = 'bottom';
  } else {
    ctx.textBaseline = 'middle';
  }
}

/**
 * 在图片布局层中获取时间Position。
 *
 * @param layout - 布局参数。
 * @param time - 谱面时间点。
 */
function getTimePosition(layout: PreviewLayout, time: number) {
  const drawCol = Math.floor(time / layout.secondsPerCol);
  const x =
    layout.infoAreaWidth +
    drawCol * layout.originalWidth +
    layout.blockDistance;
  const y = layout.height - ((time * layout.heightPerSecond) % layout.height);
  return { drawCol, x, y };
}

/**
 * 在图片布局层中绘制基础Info。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param payload - 渲染或请求负载。
 * @param coverImg - coverImg参数。
 */
function drawBaseInfo(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  payload: BestdoriPreviewPayload,
  coverImg: Image,
): void {
  const { id, diff, level } = payload;
  ctx.save();
  ctx.fillStyle = BANGDREAM_RENDER_THEME.color.chartBackground;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();

  ctx.drawImage(
    coverImg,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset,
    layout.infoAreaWidth - BANGDREAM_SONG_CHART_PREVIEW_SPEC.coverInset,
    layout.infoAreaWidth - BANGDREAM_SONG_CHART_PREVIEW_SPEC.coverInset,
  );

  ctx.save();
  ctx.fillStyle = BANGDREAM_RENDER_THEME.color.chartPanel;
  ctx.fillRect(
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.idPanel.xOffset,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.idPanel.yOffset,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.width,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.height,
  );
  ctx.fillStyle = BANGDREAM_RENDER_THEME.color.chartText;
  ctx.font = `${BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.fontSize}px "${BANGDREAM_RENDER_THEME.font.chart}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${id}`,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.idPanel.textXOffset,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.idPanel.textYOffset,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.maxWidth,
  );
  ctx.restore();

  const coverWidth =
    layout.infoAreaWidth - BANGDREAM_SONG_CHART_PREVIEW_SPEC.coverInset;
  ctx.save();
  ctx.fillStyle =
    BANGDREAM_SONG_CHART_DIFFICULTY_COLORS[diff] ??
    BANGDREAM_RENDER_THEME.color.chartDifficultyFallback;
  ctx.fillRect(
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      coverWidth +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.difficultyPanel.xFromCoverRight,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      coverWidth +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.difficultyPanel.yFromCoverBottom,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.width,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.height,
  );
  ctx.fillStyle = BANGDREAM_RENDER_THEME.color.chartText;
  ctx.font = `${BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.fontSize}px "${BANGDREAM_RENDER_THEME.font.chart}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${diff} ${level}`,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      coverWidth +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.difficultyPanel.textXFromCoverRight,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset +
      coverWidth +
      BANGDREAM_SONG_CHART_PREVIEW_SPEC.difficultyPanel
        .textYOffsetFromCoverBottom,
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel.maxWidth,
  );
  ctx.restore();
}

/**
 * 在图片布局层中绘制Tracks。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 */
function drawTracks(ctx: CanvasRenderingContext2D, layout: PreviewLayout): void {
  for (let i = 0; i < layout.colCount; i++) {
    ctx.save();
    const x =
      layout.infoAreaWidth + i * layout.originalWidth + layout.blockDistance;
    const w = layout.laneWidth * BANGDREAM_SONG_CHART_PREVIEW_SPEC.laneCount;
    const grd = ctx.createLinearGradient(
      x,
      0,
      x + layout.splitLineWidth * 2,
      0,
    );
    BANGDREAM_SONG_CHART_PREVIEW_SPEC.trackGradientStops.forEach(
      ({ color, offset }) => {
        grd.addColorStop(offset, color);
      },
    );
    ctx.fillStyle = grd;
    ctx.fillRect(
      x - layout.splitLineWidth * 2,
      0,
      layout.splitLineWidth * 2,
      layout.height,
    );
    ctx.fillRect(x + w, 0, layout.splitLineWidth * 2, layout.height);
    for (let j = 1; j <= 6; j++) {
      const splitLineX = x + layout.laneWidth * j - layout.splitLineWidth / 2;
      ctx.fillRect(splitLineX, 0, layout.splitLineWidth, layout.height);
    }
    ctx.restore();
  }
}

/**
 * 在图片布局层中绘制Beat线条列表。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param notes - 谱面音符列表。
 */
function drawBeatLines(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  notes: PreviewNote[],
): void {
  const bpmList = notes
    .filter((item) => item.type === 'BPM')
    .sort((a, b) => (a.time as number) - (b.time as number));

  ctx.save();
  for (let index = 0; index < bpmList.length; index++) {
    const bpmNote = bpmList[index];
    let beat = 0;
    const previousTime = bpmList[index - 1]
      ? (bpmList[index - 1].time as number)
      : 0;
    const nextTime = bpmList[index + 1]
      ? (bpmList[index + 1].time as number)
      : layout.chartLength;

    do {
      ctx.save();
      ctx.strokeStyle =
        beat % 1 === 0 ? 'rgba(17, 72, 74, 0.75)' : 'rgba(17, 72, 74, 0.4)';
      if (beat % 1 !== 0) {
        ctx.setLineDash([5, 5]);
      }
      const currentTime = (bpmNote.time as number) + beat * (60 / bpmNote.bpm);
      const { x, y } = getTimePosition(layout, currentTime);
      const w = BANGDREAM_SONG_CHART_PREVIEW_SPEC.laneCount * layout.laneWidth;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.stroke();
      beat += 0.5;
      ctx.restore();
    } while (
      (bpmNote.time as number) + beat * (60 / bpmNote.bpm) < nextTime &&
      (bpmNote.time as number) + beat * (60 / bpmNote.bpm) >= previousTime
    );
  }
  ctx.restore();
}

/**
 * 在图片布局层中绘制时间轴。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 */
function drawTimeline(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
): void {
  ctx.save();
  ctx.font = `18px "${BANGDREAM_RENDER_THEME.font.chart}"`;
  ctx.fillStyle = BANGDREAM_RENDER_THEME.color.chartText;
  ctx.textAlign = 'right';
  for (let i = 0; i <= layout.chartLength; i += 5) {
    const { x, y } = getTimePosition(layout, i);
    setAdaptiveTextBaseline(ctx, layout, 18, y);
    ctx.fillText(`${Math.floor(i / 60)}:${i % 60}`, x - 8, y);
  }
  ctx.restore();
}

/**
 * 在图片布局层中绘制CountAndBPM线条列表。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param notes - 谱面音符列表。
 */
function drawCountAndBpmLines(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  notes: PreviewNote[],
): void {
  let count = 0;
  const w = BANGDREAM_SONG_CHART_PREVIEW_SPEC.laneCount * layout.laneWidth;

  for (const note of notes) {
    const time = note.time as number;
    const { x, y } = getTimePosition(layout, time);

    if (isSongChartCountLineNoteType(note.type)) {
      count++;
      if (count % 50 !== 0) {
        continue;
      }
      ctx.font = `18px "${BANGDREAM_RENDER_THEME.font.chart}"`;
      ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
      ctx.textAlign = 'left';
      ctx.fillRect(x, y - 1, w, 2);
      ctx.fillStyle = BANGDREAM_RENDER_THEME.color.chartText;
      setAdaptiveTextBaseline(ctx, layout, 18, y);
      ctx.fillText(`${count}`, x + w + 8, y);
      continue;
    }

    if (note.type === 'BPM') {
      ctx.fillStyle = BANGDREAM_RENDER_THEME.color.chartBpm;
      ctx.fillRect(x, y - 1, w, 2);
      ctx.font = `18px "${BANGDREAM_RENDER_THEME.font.chart}"`;
      ctx.textAlign = 'left';
      setAdaptiveTextBaseline(ctx, layout, 18, y);
      ctx.fillText(`${note.bpm}`, x + w + 8, y);
    }
  }
}

/**
 * 在图片布局层中绘制Tap音符。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param noteImages - 音符图片列表参数。
 * @param note - 谱面音符。
 */
function drawTapNote(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  noteImages: Record<string, Image>,
  note: PreviewNote,
): void {
  const { drawCol } = getTimePosition(layout, note.time as number);
  const img = noteImages[note.type];
  const w = layout.laneWidth;
  const h = (layout.laneWidth * img.height) / img.width;
  const x =
    layout.infoAreaWidth +
    drawCol * layout.originalWidth +
    layout.blockDistance +
    (note.lane as number) * layout.laneWidth;
  const y =
    layout.height -
    (((note.time as number) * layout.heightPerSecond) % layout.height) -
    h / 2;
  ctx.drawImage(img, x, y, w, h);

  if (note.type === 'Flick') {
    ctx.drawImage(
      noteImages.FlickTop,
      x + layout.laneWidth * 0.2,
      y - h,
      layout.laneWidth * 0.6,
      (layout.laneWidth * 0.6 * noteImages.FlickTop.height) /
        noteImages.FlickTop.width,
    );
  }
}

/**
 * 在图片布局层中绘制Directional音符。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param noteImages - 音符图片列表参数。
 * @param note - 谱面音符。
 */
function drawDirectionalNote(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  noteImages: Record<string, Image>,
  note: PreviewNote,
): void {
  const { drawCol } = getTimePosition(layout, note.time as number);
  const arrowImg =
    noteImages[note.direction === 'Left' ? 'LeftArrow' : 'RightArrow'];
  const direction = note.direction === 'Left' ? -1 : 1;
  const noteWidth = note.width ?? 0;

  for (let i = 0; i < noteWidth; i++) {
    const w = layout.laneWidth;
    const h = (layout.laneWidth * arrowImg.height) / arrowImg.width;
    const x =
      layout.infoAreaWidth +
      drawCol * layout.originalWidth +
      layout.blockDistance +
      ((note.lane as number) + i * direction) * layout.laneWidth;
    const y =
      layout.height -
      (((note.time as number) * layout.heightPerSecond) % layout.height) -
      h / 2;
    ctx.drawImage(arrowImg, x, y, w, h);

    if (i + 1 === noteWidth) {
      const endImg =
        noteImages[
          note.direction === 'Left' ? 'LeftArrowEnd' : 'RightArrowEnd'
        ];
      const arrowEndX =
        direction === 1 ? x + layout.laneWidth : x - layout.laneWidth * 0.4;
      ctx.drawImage(
        endImg,
        arrowEndX,
        y,
        layout.laneWidth * 0.4,
        (layout.laneWidth * 0.4 * endImg.height) / endImg.width,
      );
    }
  }
}

/**
 * 在图片布局层中绘制Sim音符。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param noteImages - 音符图片列表参数。
 * @param note - 谱面音符。
 */
function drawSimNote(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  noteImages: Record<string, Image>,
  note: PreviewNote,
): void {
  const { drawCol } = getTimePosition(layout, note.time as number);
  const lane = note.lane as number[];
  lane.sort((a, b) => a - b);
  const simW = layout.laneWidth * (lane[1] - lane[0] - 1);
  const simH = BANGDREAM_SONG_CHART_PREVIEW_SPEC.simLineHeight;
  const simStartX =
    layout.infoAreaWidth +
    drawCol * layout.originalWidth +
    layout.blockDistance +
    (lane[0] + 1) * layout.laneWidth;
  const simY =
    layout.height -
    (((note.time as number) * layout.heightPerSecond) % layout.height) -
    simH / 2;
  ctx.drawImage(noteImages.Sim, simStartX, simY, simW, simH);
}

/**
 * 在图片布局层中绘制Bar音符。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param note - 谱面音符。
 */
function drawBarNote(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  note: PreviewNote,
): void {
  const time = note.time as number[];
  const lane = note.lane as number[];
  const startCol = Math.floor(time[0] / layout.secondsPerCol);
  const endCol = Math.floor(time[1] / layout.secondsPerCol);

  for (let i = startCol; i <= endCol; i++) {
    const x1 =
      layout.infoAreaWidth +
      i * layout.originalWidth +
      layout.blockDistance +
      lane[0] * layout.laneWidth;
    const x2 =
      layout.infoAreaWidth +
      i * layout.originalWidth +
      layout.blockDistance +
      lane[1] * layout.laneWidth;
    const y1 = layout.height * (i + 1) - time[0] * layout.heightPerSecond;
    const y2 = layout.height * (i + 1) - time[1] * layout.heightPerSecond;
    const w = layout.laneWidth * 0.8;

    ctx.beginPath();
    ctx.moveTo(x1 + (layout.laneWidth - w) / 2, y1);
    ctx.lineTo(x1 + (layout.laneWidth - w) / 2 + w, y1);
    ctx.lineTo(x2 + (layout.laneWidth - w) / 2 + w, y2);
    ctx.lineTo(x2 + (layout.laneWidth - w) / 2, y2);
    ctx.closePath();
    const grd = ctx.createLinearGradient(x1, y1, x2, y2);
    grd.addColorStop(0, 'rgba(16, 143, 19, 0.5)');
    grd.addColorStop(0.5, 'rgba(33, 177, 39, 0.5)');
    grd.addColorStop(1, 'rgba(16, 143, 19, 0.5)');
    ctx.fillStyle = grd;
    ctx.fill();
  }
}

/**
 * 在图片布局层中绘制音符列表。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 * @param noteImages - 音符图片列表参数。
 * @param notes - 谱面音符列表。
 */
function drawNotes(
  ctx: CanvasRenderingContext2D,
  layout: PreviewLayout,
  noteImages: Record<string, Image>,
  notes: PreviewNote[],
): void {
  for (const note of notes) {
    switch (note.type) {
      case 'Single':
      case 'SingleOff':
      case 'Skill':
      case 'Flick':
      case 'Long':
      case 'Tick':
        drawTapNote(ctx, layout, noteImages, note);
        break;
      case 'Directional':
        drawDirectionalNote(ctx, layout, noteImages, note);
        break;
      case 'Sim':
        drawSimNote(ctx, layout, noteImages, note);
        break;
      case 'Bar':
        drawBarNote(ctx, layout, note);
        break;
      default:
        break;
    }
  }
}

/**
 * 在图片布局层中绘制 Bestdori 谱面预览图。
 *
 * @param payload - 渲染或请求负载。
 * @param chart - 谱面音符数据。
 * @returns 异步处理结果。
 */
export async function drawBestdoriPreview(
  payload: BestdoriPreviewPayload,
  chart: BestdoriNote[],
): Promise<Canvas> {
  const { layout, notes } = createSongChartPreviewModel(chart);
  const canvas = new Canvas(layout.width, layout.height);
  const ctx = canvas.getContext('2d');
  const [noteImages, coverImg] = await Promise.all([
    loadNoteImages(),
    loadCoverImage(payload.cover),
  ]);

  drawBaseInfo(ctx, layout, payload, coverImg);
  drawTracks(ctx, layout);
  drawBeatLines(ctx, layout, notes);
  drawTimeline(ctx, layout);
  drawCountAndBpmLines(ctx, layout, notes);
  drawNotes(ctx, layout, noteImages, notes);

  return canvas;
}
