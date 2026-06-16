import { preloadBangDreamCardArtAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.renderer';
import { preloadBangDreamCardRarityAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-rarity.renderer';
import { preloadBangDreamCardSkillTextAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-skill-text.renderer';
import { preloadBangDreamPlayerAssets } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-detail.renderer';
import { preloadBangDreamBackgroundAssets } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background';
import { preloadBangDreamOutputAssets } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-output';
import { preloadBangDreamTitleAssets } from '@/modules/qqbot/plugins/bangdream/src/theme/title.renderer';

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
