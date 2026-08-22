import { Skill } from '@/modules/plugins/bangdream/src/domain/catalog/skill.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import {
  drawTipsInList,
  drawListByServerList,
} from '@/modules/plugins/bangdream/src/theme/list-frame.renderer';
import { stackImage } from '@/modules/plugins/bangdream/src/theme/image-stack';
import { Canvas } from 'skia-canvas';
import { Card } from '@/modules/plugins/bangdream/src/domain/card/card.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';

interface SkillInListOptions {
  key?: string;
  card: Card;
  content: Skill;
}
/**
 * 根据`displayedServerList`绘制或格式化Skill；从 `getServerByPriority` 读取Skill。
 * @param displayedServerList - 决定Skill内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 叠加卡牌技能名称与优先服务器技能说明后的列表画布。
 */
export async function drawSkillInList(
  { key, card, content }: SkillInListOptions,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const listImage = await drawListByServerList(
    card.skillName,
    key,
    displayedServerList,
  );
  const server = getServerByPriority(content.description, displayedServerList);
  const tipsImage = drawTipsInList({
    text: content.getSkillDescription()[server],
  });
  return stackImage([listImage, tipsImage]);
}
