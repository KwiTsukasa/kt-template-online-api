import { preloadBangDreamCardArtAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.renderer';
import { preloadBangDreamCardRarityAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-rarity.renderer';
import { preloadBangDreamCardSkillTextAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-skill-text.renderer';
import { preloadBangDreamPlayerAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-detail.renderer';
import { preloadBangDreamBackgroundAssets } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background';
import { preloadBangDreamOutputAssets } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { preloadBangDreamTitleAssets } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';

/**
 * 并发预加载背景、卡面、稀有度、技能文字、输出、玩家和标题素材，全部完成后才兑现。
 */
export async function preloadBangDreamRenderAssets() {
  await Promise.all([
    preloadBangDreamBackgroundAssets(),
    preloadBangDreamCardArtAssets(),
    preloadBangDreamCardRarityAssets(),
    preloadBangDreamCardSkillTextAssets(),
    preloadBangDreamOutputAssets(),
    preloadBangDreamPlayerAssets(),
    preloadBangDreamTitleAssets(),
  ]);
}
