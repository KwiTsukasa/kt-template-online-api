import * as path from 'path';
import { assetsRootPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';

export const BANGDREAM_LOCAL_ASSETS = {
  backgroundLive: 'BG/live.png',
  backgroundObjectBig: 'BG/bg_object_big.png',
  backgroundStar1: 'BG/star1.png',
  backgroundStar2: 'BG/star2.png',
  cardBirthday: 'Card/B.png',
  cardDreamfes: 'Card/D.png',
  cardKirafes: 'Card/K.png',
  cardLimited: 'Card/L.png',
  cardLimitBreakRank: 'Card/limitBreakRank.png',
  cardSkillTextBase: 'Card/text.png',
  cardStar: 'Card/star.png',
  cardStarTrained: 'Card/star_trained.png',
  fontFangZhengHeiTi: 'Fonts/FangZhengHeiTi_GBK.ttf',
  fontOld: 'Fonts/old.ttf',
  skillDamage: 'Skill/damage.png',
  skillJudge: 'Skill/judge.png',
  skillLife: 'Skill/life.png',
  songChartJacket: 'SongChart/jacket.png',
  songChartNoteBar: 'SongChart/note/Bar.png',
  songChartNoteFlick: 'SongChart/note/Flick.png',
  songChartNoteFlickTop: 'SongChart/note/FlickTop.png',
  songChartNoteLeftArrow: 'SongChart/note/LeftArrow.png',
  songChartNoteLeftArrowEnd: 'SongChart/note/LeftArrowEnd.png',
  songChartNoteLong: 'SongChart/note/Long.png',
  songChartNoteRightArrow: 'SongChart/note/RightArrow.png',
  songChartNoteRightArrowEnd: 'SongChart/note/RightArrowEnd.png',
  songChartNoteSim: 'SongChart/note/Sim.png',
  songChartNoteSingle: 'SongChart/note/Single.png',
  songChartNoteSingleOff: 'SongChart/note/SingleOff.png',
  songChartNoteSkill: 'SongChart/note/Skill.png',
  songChartNoteTick: 'SongChart/note/Tick.png',
  title: 'title.png',
  twServerIcon: 'tw.png',
} as const;

export type BangDreamLocalAssetKey = keyof typeof BANGDREAM_LOCAL_ASSETS;

/**
 * 解析 Tsugu 本地资源路径。
 *
 * @param key - 本地资源 manifest 键名。
 */
export function getBangDreamAssetPath(key: BangDreamLocalAssetKey): string {
  return path.join(assetsRootPath, BANGDREAM_LOCAL_ASSETS[key]);
}
