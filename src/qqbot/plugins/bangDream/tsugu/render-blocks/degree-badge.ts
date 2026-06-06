import { globalDefaultServer } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { Degree } from '@/qqbot/plugins/bangDream/tsugu/models/degree';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { Canvas } from 'skia-canvas';

/**
 * 在图片布局层中绘制称号。
 *
 * @param degree - 称号参数。
 * @param server - 目标服务器。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawDegree(
  degree: Degree,
  server: Server,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  // 如果服务器没有这个牌子，换一个有这个牌子的服务器
  if (degree.degreeName[server] == null) {
    server = getServerByPriority(degree.degreeName, displayedServerList);
  }
  const canvas = new Canvas(230, 50);
  const ctx = canvas.getContext('2d');

  const degreeImage = await degree.getDegreeImage(server); //底图
  ctx.drawImage(degreeImage, 0, 0);

  // 画其他部分,normal类型不需要画
  if (
    degree.degreeType[server] != 'normal' &&
    degree.degreeType[server] != null &&
    degree.degreeId > 12
  ) {
    //画框
    if (degree.rank[server] && degree.rank[server] != 'none') {
      const frame = await degree.getDegreeFrame(server);
      ctx.drawImage(frame, 0, 0);
    }
    //画icon
    if (degree.degreeType[server] != 'try_clear') {
      // 如果不是EX牌活动 EX牌活动没有icon在左边
      const icon = await degree.getDegreeIcon(server);
      ctx.drawImage(icon, 0, 0);
    }
  }
  return canvas;
}
