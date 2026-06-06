import { Skill } from '@/qqbot/plugins/bangDream/tsugu/models/skill';
import { Image, Canvas } from 'skia-canvas';
import { drawTextWithImages } from '@/qqbot/plugins/bangDream/tsugu/canvas/text';
import { loadImageFromPath } from '@/qqbot/plugins/bangDream/tsugu/canvas/image-utils';
import { getBangDreamAssetPath } from '@/qqbot/plugins/bangDream/tsugu/runtime/asset-manifest';
import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/theme';

const skillIcon: { [skillType: string]: Image } = {};
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
  const content: Array<Image | string> = [];
  const EffectTypes = skill.getEffectTypes();
  const ScoreUpMaxValue = skill.getScoreUpMaxValue();
  //画数字部分
  if (ScoreUpMaxValue != 0) {
    let skillValue = ScoreUpMaxValue.toString();
    if (EffectTypes.includes('score_continued_note_judge')) {
      skillValue += 'G';
    } else if (EffectTypes.includes('score_over_life')) {
      if (EffectTypes.includes('score_under_life')) {
        skillValue += 'L';
      } else {
        skillValue += '/';
      }
    } else if (
      EffectTypes.includes('score_under_great_half') ||
      EffectTypes.includes('score_perfect')
    ) {
      skillValue += 'P';
    } else if (EffectTypes.includes('score_rate_up_with_perfect')) {
      skillValue += '+0.5*P';
    }
    content.push(skillValue);
  }
  //图标部分
  EffectTypes.forEach((EffectType) => {
    if (EffectType == 'judge') {
      content.push(skillIcon.judge);
    } else if (EffectType == 'life') {
      content.push(skillIcon.life);
    } else if (EffectType == 'damage') {
      content.push(skillIcon.damage);
    }
  });
  const stringWithImage = drawTextWithImages({
    content: content,
    maxWidth: 250,
    textSize: 27,
    lineHeight: 30,
    spacing: 3,
    color: BANGDREAM_RENDER_THEME.color.surface,
    font: BANGDREAM_RENDER_THEME.font.body,
  });
  const textbase = await loadImageFromPath(
    getBangDreamAssetPath('cardSkillTextBase'),
  );
  const canvas = new Canvas(stringWithImage.width + 15, 45);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(textbase, stringWithImage.width + 15 - textbase.width, 0);
  ctx.drawImage(stringWithImage, 5, 0);
  return canvas;
}
