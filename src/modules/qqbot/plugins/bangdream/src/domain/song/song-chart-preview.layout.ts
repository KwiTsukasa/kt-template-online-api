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
 * 根据`type`与当前约束判定谱面音符是否参与谱面长度计算。
 * @param type - 决定谱面音符是否参与谱面长度计算内容、边界或目标的 `type` 值。
 * @returns 满足谱面音符是否参与谱面长度计算约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isSongChartDisplayNoteType(type: string): boolean {
  return BANGDREAM_SONG_CHART_DISPLAY_NOTE_TYPES.includes(type as never);
}

/**
 * 根据`type`与当前约束判定谱面音符是否参与计数线绘制。
 * @param type - 决定谱面音符是否参与计数线绘制内容、边界或目标的 `type` 值。
 * @returns 满足谱面音符是否参与计数线绘制约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isSongChartCountLineNoteType(type: string): boolean {
  return BANGDREAM_SONG_CHART_COUNT_LINE_NOTE_TYPES.includes(type as never);
}

/**
 * 根据`timepoints`处理sort变速点集合。
 * @param timepoints - 用于sort变速点集合的领域对象，包含 `length`、`i`、`i - 1` 字段。
 * @returns 按输入顺序得到的sort变速点集合列表；没有匹配项时为空数组。
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
 * 通过二分查找返回拍点不晚于目标拍点的最后一个变速点；目标早于全部节点时回退到首节点。
 * @param timepoints - 用于通过二分查找返回拍点不晚于目标拍点的最后一个变速点的领域对象，包含 `length`、`0`、`mid` 字段。
 * @param beat - 决定通过二分查找返回拍点不晚于目标拍点的最后一个变速点内容、边界或目标的 `beat` 值。
 * @returns 通过二分查找返回拍点不晚于目标拍点的最后一个变速点。
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
 * 按`timepoints`、`beat`读取音符时间；从 `findTimepointAtBeat` 读取音符时间。
 * @param timepoints - 决定音符时间内容、边界或目标的 `timepoints` 值。
 * @param beat - 决定音符时间内容、边界或目标的 `beat` 值。
 * @returns 音符时间。
 */
function getNoteTime(timepoints: BestdoriNote[], beat: number): number {
  const timepoint = findTimepointAtBeat(timepoints, beat);
  return (
    (timepoint.time as number) + (60 / timepoint.bpm) * (beat - timepoint.beat)
  );
}

/**
 * 通过 `chart.filter` 筛选匹配数据。
 * @param chart - 决定assign歌曲ChartTimes内容、边界或目标的 `chart` 值。
 * @returns 按输入顺序得到的assign歌曲ChartTimes列表；没有匹配项时为空数组。
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
 * 根据`notes`、`beat`、`time`更新同步音符。
 * @param notes - 用于同步音符的领域对象，包含 `push` 字段。
 * @param beat - 决定同步音符内容、边界或目标的 `beat` 值。
 * @param time - 决定同步音符内容、边界或目标的 `time` 值。
 * @param lane - 决定同步音符内容、边界或目标的 `lane` 值。
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
 * 按`note`读取Single音符Type；当 `note.flick` 成立时返回 `'Flick'`。
 * @param note - 用于Single音符Type的领域对象，包含 `flick`、`skill`、`beat` 字段。
 * @returns 当前状态对应的Single音符Type，取值为 `'Flick'`、`'Skill'`、`'SingleOff'`、`'Single'`。
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
 * 将`notes`、`note`中的非空Slide音符集合截断到安全上限后追加到目标集合。
 * @param notes - 用于Slide音符集合的领域对象，包含 `push` 字段。
 * @param note - 用于Slide音符集合的领域对象，包含 `connections` 字段。
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
        type: (() => {
          if (firstTick) {
            if (tick.skill) {
              return 'Skill';
            }
            return 'Long';
          }
          if (tick.flick) {
            return 'Flick';
          }
          if (tick.skill) {
            return 'Skill';
          }
          return 'Long';
        })(),
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
 * 将`notes`、`note`中的非空Playable音符截断到安全上限后追加到目标集合；当 `note.type === 'Single'` 成立时直接结束且不产生返回值。
 * @param notes - 用于Playable音符的领域对象，包含 `push` 字段。
 * @param note - 用于Playable音符的领域对象，包含 `type`、`lane`、`time`、`beat` 字段。
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
 * 按`note`读取SortLane；当 `Array.isArray(note.lane)` 成立时返回 `note.lane[0]`。
 * @param note - 用于SortLane的领域对象，包含 `lane` 字段。
 * @returns 用于谱面排序的轨道号；多轨音符取轨道数组第一项，单轨音符返回原值。
 */
function getSortLane(note: PreviewNote): number {
  if (Array.isArray(note.lane)) {
    return note.lane[0];
  }
  return note.lane;
}

/**
 * 根据`notes`处理sort预览音符集合。
 * @param notes - 决定sort预览音符集合内容、边界或目标的 `notes` 值。
 * @returns 按输入顺序得到的sort预览音符集合列表；没有匹配项时为空数组。
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
 * 根据`chart`构造歌曲Chart预览音符集合。
 * @param chart - 决定歌曲Chart预览音符集合内容、边界或目标的 `chart` 值。
 * @returns 按输入顺序得到的歌曲Chart预览音符集合列表；没有匹配项时为空数组。
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
 * 通过 `notes.filter` 筛选匹配数据。
 * @param notes - 决定歌曲Chart预览布局内容、边界或目标的 `notes` 值。
 * @returns 包含 `blockDistance`、`chartLength`、`colCount`、`height`、`heightPerSecond` 字段的歌曲Chart预览布局。
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
 * 根据`chart`构造针对谱面预览渲染模型。
 * @param chart - 决定针对谱面预览渲染模型内容、边界或目标的 `chart` 值。
 * @returns 包含 `layout`、`notes` 字段的针对谱面预览渲染模型。
 */
export function createSongChartPreviewModel(chart: BestdoriNote[]) {
  assignSongChartTimes(chart);
  const notes = createSongChartPreviewNotes(chart);
  return {
    layout: createSongChartPreviewLayout(notes),
    notes,
  };
}
