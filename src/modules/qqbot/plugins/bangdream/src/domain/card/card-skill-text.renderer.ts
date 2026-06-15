import { Skill } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/skill.model';
import { Image, Canvas } from 'skia-canvas';
import { drawTextWithImages } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import { getBangDreamAssetPath } from '@/modules/qqbot/plugins/bangdream/src/theme/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/modules/qqbot/plugins/bangdream/src/theme/render-theme';
import {
  BANGDREAM_SKILL_TEXT_SPEC,
  BangDreamSkillIconKey,
  createSkillTextFragments,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-skill-text.layout';

const skillIcon: Partial<Record<BangDreamSkillIconKey, Image>> = {};
/**
 * 在图片布局层中加载图片Once。
 */
async function loadImageOnce() {
  skillIcon.life = await loadImageFromPath(getBangDreamAssetPath('skillLife'));
  skillIcon.judge = await loadImageFromPath(
    getBangDreamAssetPath('skillJudge'),
  );
  skillIcon.damage = await loadImageFromPath(
    getBangDreamAssetPath('skillDamage'),
  );
}
loadImageOnce();

//卡牌Icon右下角的技能描述图标
/**
 * 在图片布局层中绘制卡牌图标技能。
 *
 * @param skill - 技能参数。
 * @returns 异步处理结果。
 */
export async function drawCardIconSkill(skill: Skill): Promise<Canvas> {
  const content = createSkillTextFragments({
    effectTypes: skill.getEffectTypes(),
    scoreUpMaxValue: skill.getScoreUpMaxValue(),
  }).flatMap((fragment): Array<Image | string> => {
    if (fragment.type === 'text') {
      return [fragment.value];
    }

    const icon = skillIcon[fragment.key];
    return icon == null ? [] : [icon];
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
