import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';
import { Canvas, Image, loadImage } from 'skia-canvas';
import mainAPI from '@/qqbot/plugins/bangDream/shared/main-data-store';
import { readJSONFromBuffer } from '@/qqbot/plugins/bangDream/shared/model-utils';
import { degreeResourceRepository } from '@/qqbot/plugins/bangDream/catalog/degree-resource.repository';

export class Degree {
  degreeId: number;
  isExist = false;
  data: object;
  degreeType: Array<string | null>;
  iconImageName: Array<string | null>;
  baseImageName: Array<string | null>;
  rank: Array<string | null>;
  degreeName: Array<string | null>;
  /**
   * 构造 Degree 实例，并初始化该模型的本地基础字段。
   *
   * @param degreeId - 称号 ID。
   */
  constructor(degreeId) {
    this.degreeId = degreeId;
    const degreeData = mainAPI['degrees'][degreeId.toString()];
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
   * 在 Degree 模型中获取称号图片。
   *
   * @param server - 目标服务器。
   * @returns 异步处理结果。
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
   * 在 Degree 模型中获取称号Frame。
   *
   * @param server - 目标服务器。
   * @returns 异步处理结果。
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
   * 在 Degree 模型中获取称号图标。
   *
   * @param server - 目标服务器。
   * @returns 异步处理结果。
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
 * 在BangDream 领域模型层中获取FrameFromAnimated称号资源。
 *
 * @param baseImageName - 基础图片名称参数。
 * @param server - 目标服务器。
 * @param frame - frame参数，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function getFrameFromAnimatedDegreeAsset(
  baseImageName: string,
  server: Server,
  frame?: number,
): Promise<Canvas> {
  const scriptBuffer =
    await degreeResourceRepository.getAnimatedScriptBuffer(
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
