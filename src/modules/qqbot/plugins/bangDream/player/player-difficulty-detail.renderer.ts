import {
  difficultyColorList,
  difficultyNameList,
} from '@/modules/qqbot/plugins/bangDream/song/song.model';
import { drawRoundedRectWithText } from '@/modules/qqbot/plugins/bangDream/theme/canvas-rect';
import { Canvas, Image } from 'skia-canvas';
import { drawTextWithImages } from '@/modules/qqbot/plugins/bangDream/theme/canvas-text';
import { drawList } from '@/modules/qqbot/plugins/bangDream/shared/list-frame.renderer';
import { Player } from '@/modules/qqbot/plugins/bangDream/player/player.model';
import {
  createDifficultyDetailBadgeSpec,
  createDifficultyDetailItemLayout,
  createDifficultyDetailListFrameSpec,
  createDifficultyDetailTextSpec,
} from '@/modules/qqbot/plugins/bangDream/player/player-difficulty-detail.layout';

interface drawDifficultyDetailInListOptions {
  [difficultyId: number]: Array<Canvas | Image | string>;
}
//画难度详情
/**
 * 在图片布局层中处理难度详情In列表。
 *
 * @param DifficultyDetailInListOptions - 难度详情In列表Options参数。
 * @param key - 当前字段键名，未传入时使用默认值。
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
 * 在图片布局层中绘制玩家难度详情In列表。
 *
 * @param player - 玩家参数。
 * @param type - 数据类型或匹配类型。
 * @param key - 当前字段键名，未传入时使用默认值。
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
