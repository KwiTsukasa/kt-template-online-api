import {
  difficultyColorList,
  difficultyNameList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { drawRoundedRectWithText } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-rect';
import { Canvas, Image } from 'skia-canvas';
import { drawTextWithImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { Player } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player.model';
import {
  createDifficultyDetailBadgeSpec,
  createDifficultyDetailItemLayout,
  createDifficultyDetailListFrameSpec,
  createDifficultyDetailTextSpec,
} from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-difficulty-detail.layout';

interface drawDifficultyDetailInListOptions {
  [difficultyId: number]: Array<Canvas | Image | string>;
}
//画难度详情
/**
 * 根据`DifficultyDetailInListOptions`、`key`处理难度详情；把图片、文本或图形按布局规格绘制到画布。
 * @param DifficultyDetailInListOptions - 控制难度详情筛选、缓存或输出方式的可选项，包含 `i` 字段。
 * @param key - 用于读取或更新难度详情的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 难度详情。
 */
function DifficultyDetailInList(
  DifficultyDetailInListOptions: drawDifficultyDetailInListOptions,
  key?: string,
) {
  const difficultyAndContentList: Array<Canvas> = [];
  for (const i in DifficultyDetailInListOptions) {
    const content = DifficultyDetailInListOptions[i];
    const tempBandIcon = drawRoundedRectWithText(
      createDifficultyDetailBadgeSpec(
        difficultyNameList[i],
        difficultyColorList[i],
      ),
    );

    const textSpec = createDifficultyDetailTextSpec();
    const tempBandRankText = drawTextWithImages({
      content,
      maxWidth: textSpec.maxWidth,
      lineHeight: textSpec.lineHeight,
    });
    const layout = createDifficultyDetailItemLayout(tempBandRankText);
    const canvas = new Canvas(layout.canvasWidth, layout.canvasHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempBandIcon, layout.badgeX, layout.badgeY);
    ctx.drawImage(tempBandRankText, layout.textX, layout.textY);
    difficultyAndContentList.push(canvas);
  }
  const frameSpec = createDifficultyDetailListFrameSpec(
    difficultyAndContentList?.[0],
  );
  const difficultyAndContentListImage = drawList({
    key,
    content: difficultyAndContentList,
    spacing: frameSpec.spacing,
    lineHeight: frameSpec.lineHeight,
    textSize: frameSpec.textSize,
  });
  return difficultyAndContentListImage;
}
//画玩家信息内不同类型的玩家详情
/**
 * 通过 `difficultyNameList.indexOf` 遍历或定位集合元素。
 * @param player - 用于玩家难度详情的领域对象，包含 `profile` 字段。
 * @param type - 决定玩家难度详情内容、边界或目标的 `type` 值。
 * @param key - 用于读取或更新玩家难度详情的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 玩家难度详情。
 */
export function drawPlayerDifficultyDetailInList(
  player: Player,
  type: 'clearedMusicCount' | 'fullComboMusicCount' | 'allPerfectMusicCount',
  key?: string,
) {
  const DifficultyDetailInListOptions = {};
  const userMusicClearInfoMap = player.profile.userMusicClearInfoMap.entries;
  for (const difficultyName in userMusicClearInfoMap) {
    if (
      Object.prototype.hasOwnProperty.call(
        userMusicClearInfoMap,
        difficultyName,
      )
    ) {
      const element = userMusicClearInfoMap[difficultyName];
      const difficultyId = difficultyNameList.indexOf(difficultyName);
      const content = [element[type].toString()];
      DifficultyDetailInListOptions[difficultyId] = content;
    }
  }
  return DifficultyDetailInList(DifficultyDetailInListOptions, key);
}
