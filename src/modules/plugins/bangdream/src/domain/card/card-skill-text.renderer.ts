import { Skill } from '@/modules/plugins/bangdream/src/domain/catalog/skill.model';
import { Image, Canvas } from 'skia-canvas';
import { drawTextWithImages } from '@/modules/plugins/bangdream/src/theme/canvas-text';
import { loadImageFromPath } from '@/modules/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/plugins/bangdream/src/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/modules/plugins/bangdream/src/theme/render-theme';
import {
  BANGDREAM_SKILL_TEXT_SPEC,
  BangDreamSkillIconKey,
  createSkillTextFragments,
} from '@/modules/plugins/bangdream/src/domain/card/card-skill-text.layout';

const skillIcon: Partial<Record<BangDreamSkillIconKey, Image>> = {};
let skillTextAssetsPreload: Promise<void> | undefined;

/**
 * 根据当前运行态处理BanG Dream卡牌Skill文本Assets；从受控资源来源加载所需数据（`loadImageFromPath`）。
 */
export async function preloadBangDreamCardSkillTextAssets() {
  if (!skillTextAssetsPreload) {
    skillTextAssetsPreload = Promise.all([
      loadImageFromPath(getBangDreamAssetPath('skillLife')),
      loadImageFromPath(getBangDreamAssetPath('skillJudge')),
      loadImageFromPath(getBangDreamAssetPath('skillDamage')),
    ])
      .then(([life, judge, damage]) => {
        skillIcon.life = life;
        skillIcon.judge = judge;
        skillIcon.damage = damage;
      })
      .catch((error) => {
        skillTextAssetsPreload = undefined;
        throw error;
      });
  }
  await skillTextAssetsPreload;
}

//卡牌Icon右下角的技能描述图标
/**
 * 通过 `flatMap` 遍历或定位集合元素。
 * @param skill - 用于卡牌图标Skill的领域对象，包含 `getEffectTypes`、`getScoreUpMaxValue` 字段。
 * @returns 卡牌图标Skill。
 */
export async function drawCardIconSkill(skill: Skill): Promise<Canvas> {
  await preloadBangDreamCardSkillTextAssets();
  const content = createSkillTextFragments({
    effectTypes: skill.getEffectTypes(),
    scoreUpMaxValue: skill.getScoreUpMaxValue(),
  }).flatMap((fragment): Array<Image | string> => {
    if (fragment.type === 'text') {
      return [fragment.value];
    }

    const icon = skillIcon[fragment.key];
    if (icon == null) {
      return [];
    }
    return [icon];
  });
  const spec = BANGDREAM_SKILL_TEXT_SPEC.layout;
  const stringWithImage = drawTextWithImages({
    content: content,
    maxWidth: spec.maxWidth,
    textSize: spec.textSize,
    lineHeight: spec.lineHeight,
    spacing: spec.spacing,
    color: BANGDREAM_RENDER_THEME.color.surface,
    font: BANGDREAM_RENDER_THEME.font.body,
  });
  const textbase = await loadImageFromPath(
    getBangDreamAssetPath('cardSkillTextBase'),
  );
  const canvas = new Canvas(
    stringWithImage.width + spec.textBasePaddingRight,
    spec.canvasHeight,
  );
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    textbase,
    stringWithImage.width + spec.textBasePaddingRight - textbase.width,
    spec.baseOffsetY,
  );
  ctx.drawImage(stringWithImage, spec.textOffsetX, spec.textOffsetY);
  return canvas;
}
