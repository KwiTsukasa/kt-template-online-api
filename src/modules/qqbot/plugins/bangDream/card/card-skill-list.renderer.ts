import { Skill } from '@/modules/qqbot/plugins/bangDream/catalog/skill.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/qqbot/plugins/bangDream/catalog/server.model';
import {
  drawTipsInList,
  drawListByServerList,
} from '@/modules/qqbot/plugins/bangDream/shared/list-frame.renderer';
import { stackImage } from '@/modules/qqbot/plugins/bangDream/shared/image-stack';
import { Canvas } from 'skia-canvas';
import { Card } from '@/modules/qqbot/plugins/bangDream/card/card.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangDream/config/runtime-config';

interface SkillInListOptions {
  key?: string;
  card: Card;
  content: Skill;
}
/**
 * 在图片布局层中绘制技能In列表。
 *
 * @param options1 - options1参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
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
