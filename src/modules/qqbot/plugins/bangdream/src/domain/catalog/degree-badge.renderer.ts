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
 * 根据`degree`、`server`、`displayedServerList`绘制或格式化称号；把图片、文本或图形按布局规格绘制到画布。
 * @param degree - 用于称号的领域对象，包含 `degreeName`、`getDegreeImage`、`degreeType`、`degreeId` 字段。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param displayedServerList - 决定称号内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
 * @returns 称号。
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
