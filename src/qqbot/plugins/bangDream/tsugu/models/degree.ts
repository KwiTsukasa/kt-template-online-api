import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data-clients/asset-cache-client';
import { downloadFile } from '@/qqbot/plugins/bangDream/tsugu/data-clients/asset-cache-client';
import { Canvas, Image, loadImage } from 'skia-canvas';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/models/main-data-store';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { readJSONFromBuffer } from './model-utils';

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
    // 资源路径修复
    try {
      const degreeImageBuffer = await downloadFile(
        `${bestdoriUrl}/assets/${Server[server]}/thumb/degree_rip/${this.baseImageName[server]}.png`,
        false,
      );
      return loadImage(degreeImageBuffer);
    } catch {
      const degreeImageBuffer = await downloadFile(
        `${bestdoriUrl}/assets/${Server[server]}/thumb/degree_rip/assets-star-forassetbundle-startapp-thumbnail-degree-${this.baseImageName[server]}.png`,
        true,
      );
      return loadImage(degreeImageBuffer);
    }
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

    const degreeFrameBuffer = await downloadFileCache(
      `${bestdoriUrl}/assets/${Server[server]}/thumb/degree_rip/${frameName}.png`,
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
    const degreeIconBuffer = await downloadFileCache(
      `${bestdoriUrl}/assets/${Server[server]}/thumb/degree_rip/${iconName}.png`,
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
  // script
  // example https://bestdori.com/assets/cn/ani_degree_bilibili_day1_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-ani_degree_bilibili_day1-ani_degree_bilibili_day1.asset
  const scriptUrl = `${bestdoriUrl}/assets/${Server[server]}/${baseImageName}_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-${baseImageName}-${baseImageName}.asset`;
  const srciptBuffer = await downloadFileCache(scriptUrl);
  const script = await readJSONFromBuffer(srciptBuffer);
  const frames: Array<Frame> = script['Base']['mSprites'] as Array<Frame>;
  const framecount = frames.length;
  if (!frame) {
    //random frame
    frame = Math.floor(Math.random() * framecount);
  }

  // texture
  // example https://bestdori.com/assets/cn/ani_degree_bilibili_day1_rip/ani_degree_bilibili_day1.png
  // example https://bestdori.com/assets/cn/ani_degree_election_5th_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-ani_degree_election_5th-ani_degree_election_5th.png
  const textureUrlOld = `${bestdoriUrl}/assets/${Server[server]}/${baseImageName}_rip/${baseImageName}.png`;
  const textureUrlNew = `${bestdoriUrl}/assets/${Server[server]}/${baseImageName}_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-${baseImageName}-${baseImageName}.png`;
  // 后期使用了统一的资源路径
  const useTextureUrlOldAssetWhitelist = [
    'ani_degree_bilibili_day1',
    'ani_degree_bilibili_092701',
    'ani_degree_bilibili_collabo',
    'ani_degree_bilibili_6years',
  ];
  let useTextureUrlOld = false;
  for (const l of useTextureUrlOldAssetWhitelist) {
    if (baseImageName == l) {
      useTextureUrlOld = true;
      break;
    }
  }
  const textureBuffer = await downloadFileCache(
    useTextureUrlOld ? textureUrlOld : textureUrlNew,
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
