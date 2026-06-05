import { Server } from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import { downloadFile } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import { Canvas, Image, loadImage } from 'skia-canvas';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import { bestdoriUrl } from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { readJSONFromBuffer } from './utils';

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
