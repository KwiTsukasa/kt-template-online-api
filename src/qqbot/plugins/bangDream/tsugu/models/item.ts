import { Image, loadImage } from 'skia-canvas';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data-clients/asset-cache-client';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { formatNumber } from '@/qqbot/plugins/bangDream/tsugu/models/model-utils';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/models/main-data-store';
import {
  globalDefaultServer,
  bestdoriUrl,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { BANGDREAM_ITEM_TYPE_PREFIXES } from '@/qqbot/plugins/bangDream/tsugu/models/bangdream-constants';

export class Item {
  name: Array<string | null>;
  resourceId: number;
  itemId: string;
  type: string;
  typeName: string;
  isExist = false;
  /**
   * 构造 Item 实例，并初始化该模型的本地基础字段。
   *
   * @param itemId - 道具 ID。
   */
  constructor(itemId: string) {
    //如果是星石
    if (itemId == 'paid_star' || itemId == 'free_star') {
      if (itemId == 'paid_star') {
        this.name = [
          '有料スター',
          'paid star',
          'paid star',
          '付费星石',
          'paid star',
        ];
      } else {
        this.name = [
          '無料スター',
          'free star',
          'free star',
          '免费星石',
          'free star',
        ];
      }
      this.resourceId = 0;
      this.type = 'star';
      this.isExist = true;
      this.typeName = 'star';
      return;
    }
    //如果是其他物品
    const itemData = mainAPI['items'][itemId];
    if (itemData == undefined) {
      return;
    }
    this.isExist = true;
    this.itemId = itemId;
    this.name = itemData['name'];
    this.resourceId = itemData['resourceId'];
    for (const [prefix, typeName] of BANGDREAM_ITEM_TYPE_PREFIXES) {
      if (this.itemId.startsWith(prefix)) {
        this.typeName = typeName;
        break;
      }
    }
  }
  /**
   * 在 Item 模型中获取道具图片。
   *
   * @param server - 目标服务器，未传入时使用默认值。
   * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
   * @returns 异步处理结果。
   */
  async getItemImage(
    server?: Server,
    displayedServerList: Server[] = globalDefaultServer,
  ): Promise<Image> {
    if (!displayedServerList) displayedServerList = globalDefaultServer;
    if (server == undefined) {
      server = getServerByPriority(this.name, displayedServerList);
    }
    server = getServerByPriority(this.name, displayedServerList);
    let itemImageBuffer: Buffer;
    if (this.typeName == 'material') {
      itemImageBuffer = await downloadFileCache(
        `${bestdoriUrl}/assets/${Server[server]}/thumb/material_rip/${this.typeName}${formatNumber(this.resourceId, 3)}.png`,
      );
    } else if (this.typeName == 'star') {
      itemImageBuffer = await downloadFileCache(
        `${bestdoriUrl}/assets/${Server[server]}/thumb/common_rip/star.png`,
      );
    } else {
      itemImageBuffer = await downloadFileCache(
        `${bestdoriUrl}/assets/${Server[server]}/thumb/common_rip/${this.typeName}${this.resourceId}.png`,
      );
    }
    return await loadImage(itemImageBuffer);
  }
}
