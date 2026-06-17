import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { Degree } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/degree.model';
import {
  Server,
  getServerByPriority,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Canvas } from 'skia-canvas';
import {
  BANGDREAM_DEGREE_LIST_SPEC,
  shouldDrawDegreeDecorations,
  shouldDrawDegreeIcon,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/degree-list.layout';

/**
 * 在图片布局层中绘制称号。
 *
 * @param degree - degree 输入；使用 `degreeName`、`degreeType`、`degreeId`、`rank` 字段生成结果。
 * @param server - server 输入；驱动 `degree.getDegreeImage()`、`degree.getDegreeFrame()`、`degree.getDegreeIcon()` 的 BangDream步骤。
 * @param displayedServerList - displayedServerList 输入；驱动 `getServerByPriority()` 的 BangDream步骤。
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
  const canvas = new Canvas(
    BANGDREAM_DEGREE_LIST_SPEC.badge.width,
    BANGDREAM_DEGREE_LIST_SPEC.badge.height,
  );
  const ctx = canvas.getContext('2d');

  const degreeImage = await degree.getDegreeImage(server); //底图
  ctx.drawImage(degreeImage, 0, 0);

  // 画其他部分,normal类型不需要画
  const degreeType = degree.degreeType[server];
  if (
    shouldDrawDegreeDecorations({
      degreeId: degree.degreeId,
      degreeType,
    })
  ) {
    //画框
    if (degree.rank[server] && degree.rank[server] != 'none') {
      const frame = await degree.getDegreeFrame(server);
      ctx.drawImage(frame, 0, 0);
    }
    //画icon
    if (shouldDrawDegreeIcon(degreeType)) {
      // 如果不是EX牌活动 EX牌活动没有icon在左边
      const icon = await degree.getDegreeIcon(server);
      ctx.drawImage(icon, 0, 0);
    }
  }
  return canvas;
}
