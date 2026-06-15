import { Image, loadImage } from 'skia-canvas';
import {
  Server,
  getServerByPriority,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import mainAPI from '@/modules/qqbot/plugins/bangdream/src/application/main-data-store';
import { itemResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/item-resource.repository';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { BANGDREAM_ITEM_TYPE_PREFIXES } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

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
    const itemImageBuffer = await itemResourceRepository.getImageBuffer(
      this,
      server,
    );
    return await loadImage(itemImageBuffer);
  }
}
