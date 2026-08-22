import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { Canvas, Image, loadImage } from 'skia-canvas';
import bangdreamCatalogCache from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import { readJSONFromBuffer } from '@/modules/plugins/bangdream/src/domain/common/model-utils';
import { degreeResourceRepository } from '@/modules/plugins/bangdream/src/domain/catalog/degree-resource.repository';

export class Degree {
  degreeId: number;
  isExist = false;
  data: object;
  degreeType: Array<string | null>;
  iconImageName: Array<string | null>;
  baseImageName: Array<string | null>;
  rank: Array<string | null>;
  degreeName: Array<string | null>;
  constructor(degreeId) {
    this.degreeId = degreeId;
    const degreeData = bangdreamCatalogCache['degrees'][degreeId.toString()];
    if (degreeData == undefined) {
      this.isExist = false;
      return;
    }
    this.isExist = true;
    this.data = this.degreeType = degreeData['degreeType'];
    this.iconImageName = degreeData['iconImageName'];
    this.baseImageName = degreeData['baseImageName'];
    this.rank = degreeData['rank'];
    this.degreeName = degreeData['degreeName'];
  }
  /**
   * 通过 `temp_baseImageName.startsWith` 判断输入是否满足函数约束。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 称号图片。
   */
  async getDegreeImage(server: Server): Promise<Image | Canvas> {
    const temp_baseImageName = this.baseImageName[server];
    //if start with "ani_"
    if (temp_baseImageName.startsWith('ani_')) {
      try {
        const degreeImageBuffer = await getFrameFromAnimatedDegreeAsset(
          temp_baseImageName,
          server,
        );
        return degreeImageBuffer;
      } catch {}
    }
    const degreeImageBuffer = await degreeResourceRepository.getThumbnailBuffer(
      this.baseImageName[server],
      server,
    );
    return loadImage(degreeImageBuffer);
  }
  /**
   * 按`server`读取称号边框；当 `frameName == 'none_none'` 成立时返回 `new Canvas(1, 1)`。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 称号边框。
   */
  async getDegreeFrame(server: Server): Promise<Image | Canvas> {
    const frameName = this.degreeType[server] + '_' + this.rank[server];
    if (frameName == 'none_none') {
      //这个为空底图
      return new Canvas(1, 1);
    }

    const degreeFrameBuffer = await degreeResourceRepository.getFrameBuffer(
      frameName,
      server,
    );
    return loadImage(degreeFrameBuffer);
  }
  /**
   * 按`server`读取称号图标；当 `this.iconImageName[server] == 'none'` 成立时返回 `new Canvas(1, 1)`。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 称号图标。
   */
  async getDegreeIcon(server: Server): Promise<Image | Canvas> {
    const iconName = this.iconImageName[server] + '_' + this.rank[server];
    if (this.iconImageName[server] == 'none') {
      //这个为空底图
      return new Canvas(1, 1);
    }
    const degreeIconBuffer = await degreeResourceRepository.getIconBuffer(
      iconName,
      server,
    );
    return loadImage(degreeIconBuffer);
  }
}
class Frame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderLeft: number;
  borderRight: number;
  borderTop: number;
  borderBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

/**
 * 按`baseImageName`、`server`、`frame`读取边框Animated称号资源；把图片、文本或图形按布局规格绘制到画布。
 * @param baseImageName - 决定边框Animated称号资源内容、边界或目标的 `baseImageName` 值。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @param frame - 决定边框Animated称号资源内容、边界或目标的 `frame` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 边框Animated称号资源。
 */
export async function getFrameFromAnimatedDegreeAsset(
  baseImageName: string,
  server: Server,
  frame?: number,
): Promise<Canvas> {
  const scriptBuffer = await degreeResourceRepository.getAnimatedScriptBuffer(
    baseImageName,
    server,
  );
  const script = await readJSONFromBuffer(scriptBuffer);
  const frames: Array<Frame> = script['Base']['mSprites'] as Array<Frame>;
  const framecount = frames.length;
  if (!frame) {
    //random frame
    frame = Math.floor(Math.random() * framecount);
  }

  const textureBuffer = await degreeResourceRepository.getAnimatedTextureBuffer(
    baseImageName,
    server,
  );
  const texture = await loadImage(textureBuffer);

  //get frame data
  const frameData = frames[frame];
  const canvas = new Canvas(frameData.width, frameData.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    texture,
    frameData.x,
    frameData.y,
    frameData.width,
    frameData.height,
    0,
    0,
    frameData.width,
    frameData.height,
  );
  //return frame image
  return canvas;
}
