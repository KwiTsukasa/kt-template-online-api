import { Skill } from '@/qqbot/plugins/bangDream/tsugu/domain/skill';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import {
  drawTipsInList,
  drawListByServerList,
} from '@/qqbot/plugins/bangDream/tsugu/layout/list';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/layout/utils';
import { Canvas } from 'skia-canvas';
import { Card } from '@/qqbot/plugins/bangDream/tsugu/domain/card';
import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';

interface SkillInListOptions {
  key?: string;
  card: Card;
  content: Skill;
}
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
