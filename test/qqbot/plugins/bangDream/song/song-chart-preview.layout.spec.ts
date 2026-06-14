import {
  assignSongChartTimes,
  BestdoriNote,
  BANGDREAM_SONG_CHART_PREVIEW_SPEC,
  createSongChartPreviewLayout,
  createSongChartPreviewModel,
  createSongChartPreviewNotes,
  isSongChartCountLineNoteType,
  isSongChartDisplayNoteType,
} from '@/modules/qqbot/plugins/bangDream/song/song-chart-preview.layout';

describe('BangDream song chart preview spec', () => {
  it('assigns note times from BPM changes', () => {
    const chart: BestdoriNote[] = [
      { beat: 0, bpm: 120, type: 'BPM' },
      { beat: 4, bpm: 240, type: 'BPM' },
      { beat: 5, lane: 1, type: 'Single' },
    ];

    assignSongChartTimes(chart);

    expect(chart[0].time).toBe(0);
    expect(chart[1].time).toBe(2);
    expect(chart[2].time).toBe(2.25);
  });

  it('converts playable notes into preview notes', () => {
    const chart: BestdoriNote[] = [
      { beat: 0, bpm: 120, type: 'BPM' },
      { beat: 1.25, lane: 1, type: 'Single' },
      { beat: 2, flick: true, lane: 2, type: 'Single' },
      { beat: 2, lane: 5, skill: true, type: 'Single' },
    ];

    assignSongChartTimes(chart);
    const notes = createSongChartPreviewNotes(chart);

    expect(notes.map((note) => note.type)).toEqual([
      'Sim',
      'BPM',
      'SingleOff',
      'Flick',
      'Skill',
    ]);
    expect(notes.find((note) => note.type === 'Sim')?.lane).toEqual([2, 5]);
  });

  it('converts slide connections into bars, ticks and endpoints', () => {
    const chart: BestdoriNote[] = [
      { beat: 0, bpm: 120, type: 'BPM' },
      {
        beat: 1,
        connections: [
          { beat: 1, lane: 1 },
          { beat: 2, lane: 3 },
          { beat: 3, flick: true, lane: 4 },
        ],
        type: 'Slide',
      },
    ];

    assignSongChartTimes(chart);
    const notes = createSongChartPreviewNotes(chart);

    expect(notes.map((note) => note.type)).toEqual([
      'Bar',
      'Bar',
      'BPM',
      'Long',
      'Tick',
      'Flick',
    ]);
    expect(notes.filter((note) => note.type === 'Bar')).toHaveLength(2);
  });

  it('creates layout from display note duration', () => {
    const layout = createSongChartPreviewLayout([
      { beat: 0, lane: 0, time: 0, type: 'BPM' },
      { beat: 1, lane: 1, time: 1, type: 'Single' },
      { beat: 120, lane: 2, time: 60, type: 'Single' },
    ]);

    expect(layout.chartLength).toBe(61);
    expect(layout.colCount).toBeGreaterThan(1);
    expect(layout.secondsPerCol).toBe(layout.chartLength / layout.colCount);
  });

  it('classifies display and count-line note types', () => {
    expect(isSongChartDisplayNoteType('Long')).toBe(true);
    expect(isSongChartDisplayNoteType('BPM')).toBe(false);
    expect(isSongChartCountLineNoteType('Tick')).toBe(true);
    expect(isSongChartCountLineNoteType('Sim')).toBe(false);
  });

  it('creates preview model in one call', () => {
    const chart: BestdoriNote[] = [
      { beat: 0, bpm: 120, type: 'BPM' },
      { beat: 1, lane: 1, type: 'Single' },
    ];

    const model = createSongChartPreviewModel(chart);

    expect(model.notes.some((note) => note.type === 'Single')).toBe(true);
    expect(model.layout.width).toBeGreaterThan(0);
  });

  it('keeps the drawing-only panel and gradient specs stable', () => {
    expect(BANGDREAM_SONG_CHART_PREVIEW_SPEC.infoOffset).toBe(8);
    expect(BANGDREAM_SONG_CHART_PREVIEW_SPEC.coverInset).toBe(16);
    expect(BANGDREAM_SONG_CHART_PREVIEW_SPEC.panel).toEqual({
      fontSize: 16,
      height: 24,
      maxWidth: 128,
      width: 128,
    });
    expect(BANGDREAM_SONG_CHART_PREVIEW_SPEC.simLineHeight).toBe(2);
    expect(BANGDREAM_SONG_CHART_PREVIEW_SPEC.trackGradientStops).toEqual([
      { color: '#2F4E6F', offset: 0 },
      { color: '#3E6F8A', offset: 0.5 },
      { color: '#4D80A4', offset: 1 },
    ]);
  });
});
