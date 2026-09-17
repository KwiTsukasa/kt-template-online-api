export const MEDIA_FILE_SELECTION = Object.freeze({
  episodeMarker:
    /(?:^|[^a-z0-9])(?:S(\d{1,2}))?E(?:P)?\s*(\d{1,4})(?![a-z0-9])/giu,
  episodeRange: /^\s*[-~–]\s*(?:E(?:P)?)?\d/iu,
  bracketEpisode: /\[(\d{1,3})\]/gu,
  independentNumber: /(?:^|[._ -])(\d{1,3})(?=$|[._ \[\]()-])/gu,
  maxEpisode: 2000,
  ambiguousMapping: '来源自动选择存在重复或不完整映射，请手动复核',
});
