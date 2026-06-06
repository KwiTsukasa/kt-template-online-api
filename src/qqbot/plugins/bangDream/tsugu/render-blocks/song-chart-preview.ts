import { Canvas, Image, loadImage } from 'skia-canvas';
import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';

interface BestdoriPreviewPayload {
  id: number;
  title?: string;
  artist?: string;
  author?: string;
  diff: string;
  level: number;
  cover: string | Buffer;
}

interface BestdoriConnection {
  beat: number;
  lane: number;
  time?: number;
  skill?: boolean;
  flick?: boolean;
  hidden?: boolean;
}

interface BestdoriNote {
  type: string;
  beat: number;
  lane?: number;
  time?: number | number[];
  bpm?: number;
  connections?: BestdoriConnection[];
  skill?: boolean;
  flick?: boolean;
  direction?: 'Left' | 'Right';
  width?: number;
  hidden?: boolean;
}

type PreviewNote = Omit<BestdoriNote, 'time' | 'lane'> & {
  type: string;
  time: number | number[];
  lane: number | number[];
};

interface PreviewLayout {
  infoAreaWidth: number;
  laneWidth: number;
  splitLineWidth: number;
  blockDistance: number;
  heightPerSecond: number;
  originalWidth: number;
  chartLength: number;
  secondsPerCol: number;
  width: number;
  height: number;
  colCount: number;
}

const OFFSET = 8;
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
const DISPLAY_NOTE_TYPES = [
  'Single',
  'SingleOff',
  'Skill',
  'Flick',
  'Directional',
  'Long',
];
const COUNT_LINE_NOTE_TYPES = [
  'Single',
  'SingleOff',
  'Flick',
  'Long',
  'Skill',
  'Tick',
  'Directional',
];
const DIFFICULTY_COLOR_LIST: Record<string, string> = {
  easy: 'rgb(87, 192, 201)',
  normal: 'rgb(138, 201, 87)',
  hard: 'rgb(239, 161, 25)',
  expert: 'rgb(199, 96, 96)',
  special: 'rgb(195, 96, 199)',
};

/**
 * 在图片布局层中按节拍排序 BPM 时间点并写入累计时间。
 *
 * @param timepoints - BPM 时间点列表。
 * @returns 处理后的列表。
 */
function sortTimepoints(timepoints: BestdoriNote[]): BestdoriNote[] {
  timepoints.sort((a, b) => a.beat - b.beat);
  for (let i = 0; i < timepoints.length; i++) {
    const current = timepoints[i];
    if (i === 0) {
      current.time = 0;
      continue;
    }

    const previous = timepoints[i - 1];
    current.time =
      (previous.time as number) +
      (current.beat - previous.beat) * (60 / previous.bpm);
  }
  return timepoints;
}

/**
 * 在图片布局层中用二分查找定位节拍所在的 BPM 时间点。
 *
 * @param timepoints - BPM 时间点列表。
 * @param beat - 谱面节拍位置。
 * @returns 处理结果。
 */
function findTimepointAtBeat(
  timepoints: BestdoriNote[],
  beat: number,
): BestdoriNote {
  let left = 0;
  let right = timepoints.length - 1;
  let result = timepoints[0];

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (timepoints[mid].beat > beat) {
      right = mid - 1;
      continue;
    }
    result = timepoints[mid];
    left = mid + 1;
  }

  return result;
}

/**
 * 在图片布局层中根据 BPM 时间点计算谱面音符时间。
 *
 * @param timepoints - BPM 时间点列表。
 * @param beat - 谱面节拍位置。
 * @returns 计算后的数值。
 */
function getNoteTime(timepoints: BestdoriNote[], beat: number): number {
  const timepoint = findTimepointAtBeat(timepoints, beat);
  return (
    (timepoint.time as number) + (60 / timepoint.bpm) * (beat - timepoint.beat)
  );
}

/**
 * 在图片布局层中为谱面音符写入实际时间。
 *
 * @param chart - 谱面音符数据。
 * @returns 处理后的列表。
 */
function assignChartTimes(chart: BestdoriNote[]): BestdoriNote[] {
  const timepoints = sortTimepoints(
    chart.filter((note) => note.type === 'BPM'),
  );

  for (const note of chart) {
    if (note.type === 'Long' || note.type === 'Slide') {
      for (const connection of note.connections ?? []) {
        connection.time = getNoteTime(timepoints, connection.beat);
      }
      continue;
    }
    if (note.type !== 'BPM') {
      note.time = getNoteTime(timepoints, note.beat);
    }
  }

  return timepoints;
}

/**
 * 在图片布局层中为同拍音符补充双押标记。
 *
 * @param notes - 谱面音符列表。
 * @param beat - 谱面节拍位置。
 * @param time - 谱面时间点。
 * @param lane - 轨道位置。
 */
function addSimNote(
  notes: PreviewNote[],
  beat: number,
  time: number,
  lane: number,
): void {
  for (const note of notes) {
    if (note.beat === beat && note.lane === lane) {
      continue;
    }
    if (
      ['Single', 'Flick', 'Skill', 'Long', 'Directional'].includes(note.type) &&
      note.beat === beat
    ) {
      notes.push({
        type: 'Sim',
        beat,
        time,
        lane: [note.lane as number, lane].sort((a, b) => a - b),
      });
    }
  }
}

/**
 * 在图片布局层中识别单点音符的展示类型。
 *
 * @param note - 谱面音符。
 * @returns 格式化后的文本。
 */
function getSingleNoteType(note: BestdoriNote): string {
  if (note.flick) {
    return 'Flick';
  }
  if (note.skill) {
    return 'Skill';
  }
  if (note.beat % 0.5 !== 0) {
    return 'SingleOff';
  }
  return 'Single';
}

/**
 * 在图片布局层中把滑条连接点拆成可绘制音符。
 *
 * @param notes - 谱面音符列表。
 * @param note - 谱面音符。
 */
function pushSlideNotes(notes: PreviewNote[], note: BestdoriNote): void {
  const barTime: number[] = [];
  const lane: number[] = [];
  const connections = note.connections ?? [];

  for (let i = 0; i < connections.length; i++) {
    const tick = connections[i];
    const time = tick.time;
    const firstTick = i === 0;
    const lastTick = i === connections.length - 1;

    barTime.push(time);
    lane.push(tick.lane);

    if (!firstTick) {
      notes.push({
        type: 'Bar',
        beat: tick.beat,
        time: [barTime[0], barTime[1]],
        lane: [lane[0], lane[1]],
      });
    }

    if (firstTick || lastTick) {
      notes.push({
        ...tick,
        type: firstTick
          ? tick.skill
            ? 'Skill'
            : 'Long'
          : tick.flick
            ? 'Flick'
            : tick.skill
              ? 'Skill'
              : 'Long',
        time,
        lane: tick.lane,
      });
      addSimNote(notes, tick.beat, time, tick.lane);
      continue;
    }

    lane.shift();
    barTime.shift();
    if (!tick.hidden) {
      notes.push({ ...tick, type: 'Tick', time, lane: tick.lane });
    }
  }
}

/**
 * 在图片布局层中把可游玩音符转换为预览音符。
 *
 * @param notes - 谱面音符列表。
 * @param note - 谱面音符。
 */
function pushPlayableNote(notes: PreviewNote[], note: BestdoriNote): void {
  if (note.type === 'Single') {
    const typedNote = {
      ...note,
      type: getSingleNoteType(note),
      time: note.time as number,
      lane: note.lane,
    } as PreviewNote;
    notes.push(typedNote);
    addSimNote(notes, note.beat, typedNote.time as number, note.lane);
    return;
  }

  if (note.type === 'Directional') {
    notes.push({
      ...note,
      time: note.time as number,
      lane: note.lane,
    } as PreviewNote);
    addSimNote(notes, note.beat, note.time as number, note.lane);
  }
}

/**
 * 在图片布局层中获取Sort轨道。
 *
 * @param note - 谱面音符。
 * @returns 计算后的数值。
 */
function getSortLane(note: PreviewNote): number {
  return Array.isArray(note.lane) ? note.lane[0] : note.lane;
}

/**
 * 在图片布局层中按时间和轨道排序预览音符。
 *
 * @param notes - 谱面音符列表。
 * @returns 处理后的列表。
 */
function sortPreviewNotes(notes: PreviewNote[]): PreviewNote[] {
  /**
   * 在图片布局层中处理类型Sort。
   *
   * @param type - 数据类型或匹配类型。
   * @returns 计算后的数值。
   */
  const typeSort = (type: string): number => ({ Bar: -2, Sim: -1 })[type] || 0;
  notes.sort((a, b) => {
    const typeSortResult = typeSort(a.type) - typeSort(b.type);
    if (typeSortResult !== 0) {
      return typeSortResult;
    }
    if (a.time !== b.time) {
      return (a.time as number) - (b.time as number);
    }
    return getSortLane(a) - getSortLane(b);
  });
  return notes;
}

/**
 * 在图片布局层中把 Bestdori 谱面转换为预览音符列表。
 *
 * @param chart - 谱面音符数据。
 * @returns 处理后的列表。
 */
function createPreviewNotes(chart: BestdoriNote[]): PreviewNote[] {
  const notes: PreviewNote[] = [];

  for (const note of chart) {
    if (note.type === 'Slide' || note.type === 'Long') {
      pushSlideNotes(notes, note);
      continue;
    }
    if (note.type === 'BPM') {
      notes.push(note as PreviewNote);
      continue;
    }
    pushPlayableNote(notes, note);
  }

  return sortPreviewNotes(notes);
}

/**
 * 在图片布局层中根据谱面长度创建预览布局参数。
 *
 * @param notes - 谱面音符列表。
 * @returns 处理结果。
 */
function createPreviewLayout(notes: PreviewNote[]): PreviewLayout {
  const infoAreaWidth = 240;
  const laneWidth = 32;
  const splitLineWidth = 2;
  const blockDistance = 72;
  const heightPerSecond = 216;
  const displayNotes = notes.filter((note) =>
    DISPLAY_NOTE_TYPES.includes(note.type),
  );
  const chartLength = Math.ceil(
    (displayNotes[displayNotes.length - 1].time as number) + 0.25,
  );
  const minHeight = 500;
  const originalWidth = blockDistance * 2 + laneWidth * 7;
  const originalHeight = heightPerSecond * chartLength;
  let width = infoAreaWidth + originalWidth;
  let height = originalHeight;
  let colCount = 1;

  while (width / height < 16 / 9) {
    if (width / height > 4 / 3) {
      break;
    }
    if (Math.ceil(originalHeight / (colCount + 1)) < minHeight) {
      break;
    }
    colCount++;

    const newWidth = infoAreaWidth + originalWidth * colCount;
    const newHeight = originalHeight / colCount;
    if (newHeight < minHeight) {
      break;
    }

    width = newWidth;
    height = newHeight;
  }

  return {
    infoAreaWidth,
    laneWidth,
    splitLineWidth,
    blockDistance,
    heightPerSecond,
    originalWidth,
    chartLength,
    secondsPerCol: chartLength / colCount,
    width,
    height,
    colCount,
  };
}

/**
 * 在图片布局层中加载谱面预览所需音符贴图。
 *
 * @returns 异步处理结果。
 */
async function loadNoteImages(): Promise<Record<string, Image>> {
  const entries = await Promise.all(
    NOTE_IMAGE_KEYS.map(async (key) => [
      key,
      await loadImageFromPath(`${assetsRootPath}/SongChart/note/${key}.png`),
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
    return await loadImageFromPath(`${assetsRootPath}/SongChart/jacket.png`);
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
  ctx: any,
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
  ctx: any,
  layout: PreviewLayout,
  payload: BestdoriPreviewPayload,
  coverImg: Image,
): void {
  const { id, diff, level } = payload;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();

  ctx.drawImage(
    coverImg,
    OFFSET,
    OFFSET,
    layout.infoAreaWidth - 16,
    layout.infoAreaWidth - 16,
  );

  ctx.save();
  ctx.fillStyle = '#1f1e33';
  ctx.fillRect(OFFSET - 8, OFFSET - 8, 128, 24);
  ctx.fillStyle = '#FFF';
  ctx.font = '16px "Arial"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${id}`, OFFSET + 56, OFFSET + 4, 128);
  ctx.restore();

  const coverWidth = layout.infoAreaWidth - 16;
  ctx.save();
  ctx.fillStyle = DIFFICULTY_COLOR_LIST[diff] ?? '#777';
  ctx.fillRect(8 + coverWidth - 116, 8 + coverWidth - 12, 128, 24);
  ctx.fillStyle = '#FFF';
  ctx.font = '16px "Arial"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${diff} ${level}`, 8 + coverWidth - 52, 8 + coverWidth, 128);
  ctx.restore();
}

/**
 * 在图片布局层中绘制Tracks。
 *
 * @param ctx - 画布绘图上下文。
 * @param layout - 布局参数。
 */
function drawTracks(ctx: any, layout: PreviewLayout): void {
  for (let i = 0; i < layout.colCount; i++) {
    ctx.save();
    const x =
      layout.infoAreaWidth + i * layout.originalWidth + layout.blockDistance;
    const w = layout.laneWidth * 7;
    const grd = ctx.createLinearGradient(
      x,
      0,
      x + layout.splitLineWidth * 2,
      0,
    );
    grd.addColorStop(0, '#2F4E6F');
    grd.addColorStop(0.5, '#3E6F8A');
    grd.addColorStop(1, '#4D80A4');
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
  ctx: any,
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
      const w = 7 * layout.laneWidth;
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
function drawTimeline(ctx: any, layout: PreviewLayout): void {
  ctx.save();
  ctx.font = '18px "Arial"';
  ctx.fillStyle = '#FFF';
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
  ctx: any,
  layout: PreviewLayout,
  notes: PreviewNote[],
): void {
  let count = 0;
  const w = 7 * layout.laneWidth;

  for (const note of notes) {
    const time = note.time as number;
    const { x, y } = getTimePosition(layout, time);

    if (COUNT_LINE_NOTE_TYPES.includes(note.type)) {
      count++;
      if (count % 50 !== 0) {
        continue;
      }
      ctx.font = '18px "Arial"';
      ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
      ctx.textAlign = 'left';
      ctx.fillRect(x, y - 1, w, 2);
      ctx.fillStyle = '#FFF';
      setAdaptiveTextBaseline(ctx, layout, 18, y);
      ctx.fillText(`${count}`, x + w + 8, y);
      continue;
    }

    if (note.type === 'BPM') {
      ctx.fillStyle = '#C34FBB';
      ctx.fillRect(x, y - 1, w, 2);
      ctx.font = '18px "Arial"';
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
  ctx: any,
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
  ctx: any,
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
  ctx: any,
  layout: PreviewLayout,
  noteImages: Record<string, Image>,
  note: PreviewNote,
): void {
  const { drawCol } = getTimePosition(layout, note.time as number);
  const lane = note.lane as number[];
  lane.sort((a, b) => a - b);
  const simW = layout.laneWidth * (lane[1] - lane[0] - 1);
  const simH = 2;
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
function drawBarNote(ctx: any, layout: PreviewLayout, note: PreviewNote): void {
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
  ctx: any,
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
  assignChartTimes(chart);
  const notes = createPreviewNotes(chart);
  const layout = createPreviewLayout(notes);
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
