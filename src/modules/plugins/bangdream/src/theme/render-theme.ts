export const BANGDREAM_RENDER_THEME = {
  color: {
    backgroundEasy: '#fef3ef',
    chartBackground: '#000',
    chartBpm: '#C34FBB',
    chartDifficultyFallback: '#777',
    chartPanel: '#1f1e33',
    chartText: '#FFF',
    labelBackground: '#5b5b5b',
    mutedText: '#a7a7a7',
    primaryText: '#505050',
    separator: '#a8a8a8',
    skillLevelBackground: '#ff0000',
    subtlePanel: '#f1f1f1',
    surface: '#ffffff',
  },
  font: {
    body: 'old',
    chart: 'Arial',
    chinese: 'FangZhengHeiTi',
    fallback: 'Microsoft Yahei',
  },
  layout: {
    contentWidth: 800,
    defaultGap: 20,
    listIndent: 20,
  },
} as const;

export type BangDreamRenderFont =
  (typeof BANGDREAM_RENDER_THEME.font)[keyof typeof BANGDREAM_RENDER_THEME.font];
