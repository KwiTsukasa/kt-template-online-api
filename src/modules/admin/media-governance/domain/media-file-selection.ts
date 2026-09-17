import { MEDIA_FILE_SELECTION } from '../constants/file-selection';

/**
 * 在扩展名分类前排除同步程序保留的临时路径，所有自动视频与字幕选择使用同一候选边界。
 * @param relativePath - 已规范化为正斜杠的来源清单相对路径。
 * @returns 可自动选择的视频或字幕角色；同步临时文件及其他类型返回空。
 */
export function automaticMediaFileRole(relativePath: string): 'subtitle' | 'video' | null {
  if (MEDIA_FILE_SELECTION.synchronizationTemporaryPath.test(relativePath)) return null;
  if (MEDIA_FILE_SELECTION.videoSuffix.test(relativePath)) return 'video';
  if (MEDIA_FILE_SELECTION.subtitleSuffix.test(relativePath)) return 'subtitle';
  return null;
}

/**
 * 从无显式集号标记的根文件名读取末尾独立方括号或唯一数字，年份和分辨率不参与匹配。
 * @param name - 已排除目录部分的来源文件名。
 * @returns 唯一可判定的集号；没有匹配或存在多个独立数字时返回空。
 */
function unmarkedEpisodeNumber(name: string): null | number {
  const bracket = [...name.matchAll(MEDIA_FILE_SELECTION.bracketEpisode)].at(
    -1,
  );
  if (bracket) return Number(bracket[1]);
  const numbers = new Set(
    [...name.matchAll(MEDIA_FILE_SELECTION.independentNumber)]
      .map((match) => Number(match[1]))
      .filter((value) => value > 0),
  );
  if (numbers.size !== 1) return null;
  return numbers.values().next().value ?? null;
}

/**
 * 将明确的 SxxExx、单季 E/EP 集号或原有根文件数字映射到声明季；单季业务声明优先于发布方的季编号。
 * @param relativePath - 受控来源清单中的相对文件路径。
 * @param unitsBySeason - 本次来源明确声明且实际存在的季到治理单元索引。
 * @returns 唯一集号及治理单元；多季未命中、范围或多个集号标记均返回空，不猜测目标季。
 */
export function resolveMediaFileEpisode(
  relativePath: string,
  unitsBySeason: ReadonlyMap<string, string>,
): null | { episodeNumber: number; unitId: string } {
  const separator = relativePath.lastIndexOf('/');
  const name = relativePath.slice(separator + 1);
  const markers = [...name.matchAll(MEDIA_FILE_SELECTION.episodeMarker)];
  if (markers.length > 1) return null;
  const marker = markers[0];
  let episodeNumber: null | number;
  let seasonNumber: string | undefined;
  if (marker) {
    const afterMarker = name.slice(marker.index + marker[0].length);
    if (MEDIA_FILE_SELECTION.episodeRange.test(afterMarker)) return null;
    episodeNumber = Number(marker[2]);
    if (marker[1]) seasonNumber = `S${marker[1].padStart(2, '0')}`;
    else if (separator >= 0) return null;
  } else {
    if (separator >= 0) return null;
    episodeNumber = unmarkedEpisodeNumber(name);
  }
  if (
    episodeNumber === null ||
    episodeNumber < 1 ||
    episodeNumber > MEDIA_FILE_SELECTION.maxEpisode
  )
    return null;
  let unitId: string | undefined;
  if (seasonNumber) unitId = unitsBySeason.get(seasonNumber);
  if (!unitId && unitsBySeason.size === 1)
    unitId = unitsBySeason.values().next().value;
  if (!unitId) return null;
  return { episodeNumber, unitId };
}
