import { Skill } from '@/qqbot/plugins/bangDream/tsugu/models/skill';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawTipsInList, drawListByServerList } from './list-frame';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import { Canvas } from 'skia-canvas';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/models/card';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';

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
