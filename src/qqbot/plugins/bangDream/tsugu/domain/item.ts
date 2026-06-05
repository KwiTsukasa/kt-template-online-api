import { Image, loadImage } from 'skia-canvas';
import { downloadFileCache } from '@/qqbot/plugins/bangDream/tsugu/data/download-file';
import {
  Server,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/tsugu/domain/server';
import { formatNumber } from '@/qqbot/plugins/bangDream/tsugu/domain/utils';
import mainAPI from '@/qqbot/plugins/bangDream/tsugu/domain/main-api';
import {
  globalDefaultServer,
  bestdoriUrl,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/tsugu-config';
import { BANGDREAM_ITEM_TYPE_PREFIXES } from '@/qqbot/plugins/bangDream/tsugu/domain/bangdream.enum';

export class Item {
  name: Array<string | null>;
  resourceId: number;
  itemId: string;
  type: string;
  typeName: string;
  isExist = false;
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
