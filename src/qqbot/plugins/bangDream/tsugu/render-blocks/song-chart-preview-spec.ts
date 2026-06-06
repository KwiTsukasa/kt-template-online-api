export interface BestdoriConnection {
  beat: number;
  lane: number;
  time?: number;
  skill?: boolean;
  flick?: boolean;
  hidden?: boolean;
}

export interface BestdoriNote {
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

export type PreviewNote = Omit<BestdoriNote, 'time' | 'lane'> & {
  type: string;
  time: number | number[];
  lane: number | number[];
};

export interface PreviewLayout {
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

export const BANGDREAM_SONG_CHART_PREVIEW_SPEC = {
  aspectRatioLimit: 16 / 9,
  blockDistance: 72,
  coverInset: 16,
  heightPerSecond: 216,
  infoAreaWidth: 240,
  infoOffset: 8,
  laneCount: 7,
  laneWidth: 32,
  minHeight: 500,
  noteEndPaddingSeconds: 0.25,
  panel: {
    fontSize: 16,
    height: 24,
    maxWidth: 128,
    width: 128,
  },
  difficultyPanel: {
    textXFromCoverRight: -52,
    textYOffsetFromCoverBottom: 0,
    xFromCoverRight: -116,
    yFromCoverBottom: -12,
  },
  idPanel: {
    textXOffset: 56,
    textYOffset: 4,
    xOffset: -8,
    yOffset: -8,
  },
  simLineHeight: 2,
  splitLineWidth: 2,
  trackGradientStops: [
    { color: '#2F4E6F', offset: 0 },
    { color: '#3E6F8A', offset: 0.5 },
    { color: '#4D80A4', offset: 1 },
  ],
} as const;

export const BANGDREAM_SONG_CHART_DISPLAY_NOTE_TYPES = [
  'Single',
  'SingleOff',
  'Skill',
  'Flick',
  'Directional',
  'Long',
] as const;

export const BANGDREAM_SONG_CHART_COUNT_LINE_NOTE_TYPES = [
  'Single',
  'SingleOff',
  'Flick',
  'Long',
  'Skill',
  'Tick',
  'Directional',
] as const;

export const BANGDREAM_SONG_CHART_DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'rgb(87, 192, 201)',
  expert: 'rgb(199, 96, 96)',
  hard: 'rgb(239, 161, 25)',
  normal: 'rgb(138, 201, 87)',
  special: 'rgb(195, 96, 199)',
};

const PREVIEW_NOTE_TYPE_SORT: Record<string, number> = {
  Bar: -2,
  Sim: -1,
};

/**
 * 判断谱面音符是否参与谱面长度计算。
 *
 * @param type - 预览音符类型。
 */
export function isSongChartDisplayNoteType(type: string): boolean {
  return BANGDREAM_SONG_CHART_DISPLAY_NOTE_TYPES.includes(type as never);
}

/**
 * 判断谱面音符是否参与计数线绘制。
 *
 * @param type - 预览音符类型。
 */
export function isSongChartCountLineNoteType(type: string): boolean {
  return BANGDREAM_SONG_CHART_COUNT_LINE_NOTE_TYPES.includes(type as never);
}

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
 * @returns 处理后的 BPM 时间点列表。
 */
export function assignSongChartTimes(chart: BestdoriNote[]): BestdoriNote[] {
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
        beat,
        lane: [note.lane as number, lane].sort((a, b) => a - b),
        time,
        type: 'Sim',
      });
    }
  }
}

/**
 * 在图片布局层中识别单点音符的展示类型。
 *
 * @param note - 谱面音符。
 * @returns 预览音符类型。
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
        beat: tick.beat,
        lane: [lane[0], lane[1]],
        time: [barTime[0], barTime[1]],
        type: 'Bar',
      });
    }

    if (firstTick || lastTick) {
      notes.push({
        ...tick,
        lane: tick.lane,
        time,
        type: firstTick
          ? tick.skill
            ? 'Skill'
            : 'Long'
          : tick.flick
            ? 'Flick'
            : tick.skill
              ? 'Skill'
              : 'Long',
      });
      addSimNote(notes, tick.beat, time, tick.lane);
      continue;
    }

    lane.shift();
    barTime.shift();
    if (!tick.hidden) {
      notes.push({ ...tick, lane: tick.lane, time, type: 'Tick' });
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
      lane: note.lane,
      time: note.time as number,
      type: getSingleNoteType(note),
    } as PreviewNote;
    notes.push(typedNote);
    addSimNote(notes, note.beat, typedNote.time as number, note.lane);
    return;
  }

  if (note.type === 'Directional') {
    notes.push({
      ...note,
      lane: note.lane,
      time: note.time as number,
    } as PreviewNote);
    addSimNote(notes, note.beat, note.time as number, note.lane);
  }
}

/**
 * 在图片布局层中获取排序轨道。
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
  notes.sort((a, b) => {
    const typeSortResult =
      (PREVIEW_NOTE_TYPE_SORT[a.type] || 0) -
      (PREVIEW_NOTE_TYPE_SORT[b.type] || 0);
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
export function createSongChartPreviewNotes(
  chart: BestdoriNote[],
): PreviewNote[] {
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
export function createSongChartPreviewLayout(
  notes: PreviewNote[],
): PreviewLayout {
  const {
    aspectRatioLimit,
    blockDistance,
    heightPerSecond,
    infoAreaWidth,
    laneCount,
    laneWidth,
    minHeight,
    noteEndPaddingSeconds,
    splitLineWidth,
  } = BANGDREAM_SONG_CHART_PREVIEW_SPEC;
  const displayNotes = notes.filter((note) =>
    isSongChartDisplayNoteType(note.type),
  );
  const chartLength = Math.ceil(
    (displayNotes[displayNotes.length - 1].time as number) +
      noteEndPaddingSeconds,
  );
  const originalWidth = blockDistance * 2 + laneWidth * laneCount;
  const originalHeight = heightPerSecond * chartLength;
  let width = infoAreaWidth + originalWidth;
  let height = originalHeight;
  let colCount = 1;

  while (width / height < aspectRatioLimit) {
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
    blockDistance,
    chartLength,
    colCount,
    height,
    heightPerSecond,
    infoAreaWidth,
    laneWidth,
    originalWidth,
    secondsPerCol: chartLength / colCount,
    splitLineWidth,
    width,
  };
}

/**
 * 创建谱面预览渲染模型。
 *
 * @param chart - Bestdori 谱面数据。
 * @returns 预览音符和布局。
 */
export function createSongChartPreviewModel(chart: BestdoriNote[]) {
  assignSongChartTimes(chart);
  const notes = createSongChartPreviewNotes(chart);
  return {
    layout: createSongChartPreviewLayout(notes),
    notes,
  };
}
