import { drawList } from './list-frame';
import { Gacha } from '@/qqbot/plugins/bangDream/tsugu/models/gacha';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { Item } from '@/qqbot/plugins/bangDream/tsugu/models/item';
import { stackImage } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/image-stack';
import {
  BANGDREAM_GACHA_LIST_SPEC,
  getGachaPaymentBehaviorLabel,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/gacha-list-spec';

/**
 * 在图片布局层中绘制Gasha支付方式MethodIn列表。
 *
 * @param gacha - 卡池参数。
 */
export async function drawGashaPaymentMethodInList(gacha: Gacha) {
  const list = [];
  const patmentMethods = gacha.paymentMethods;
  for (let i = 0; i < patmentMethods.length; i++) {
    const patmentMethod = patmentMethods[i];
    const methodDescription = [];
    methodDescription.push(`${i + 1}.`);

    //付费方式
    let itemId = '';
    const costItemQuantity = patmentMethod.costItemQuantity;
    if (
      patmentMethod.paymentMethod == 'free_star' ||
      patmentMethod.paymentMethod == 'paid_star'
    ) {
      itemId = patmentMethod.paymentMethod;
    } else if (patmentMethod.ticketId != undefined) {
      itemId = 'gacha_ticket_' + patmentMethod.ticketId;
    }
    const item = new Item(itemId);
    if (item.isExist) {
      methodDescription.push(await item.getItemImage());
      if (item.typeName == 'star') {
        methodDescription.push(item.name[Server.cn]);
      }
      methodDescription.push(`x${costItemQuantity}`);
    } else {
      methodDescription.push(
        `${BANGDREAM_GACHA_LIST_SPEC.paymentText.unknownItemPrefix}${costItemQuantity}`,
      );
    }

    //抽卡次数
    if (patmentMethod.count != undefined) {
      methodDescription.push(
        `${patmentMethod.count}${BANGDREAM_GACHA_LIST_SPEC.paymentText.drawCountSuffix}`,
      );
    }

    //更多情况描述
    const behaviorLabel = getGachaPaymentBehaviorLabel(patmentMethod.behavior);
    if (behaviorLabel !== '') {
      methodDescription.push(' ' + behaviorLabel);
    }
    if (patmentMethod['maxSpinLimit'] != undefined) {
      methodDescription.push(
        `${BANGDREAM_GACHA_LIST_SPEC.paymentText.limitPrefix}${patmentMethod['maxSpinLimit']}${BANGDREAM_GACHA_LIST_SPEC.paymentText.limitSuffix}`,
      );
    }
    const isFirst = i == 0;
    list.push(
      drawList({
        key: isFirst
          ? BANGDREAM_GACHA_LIST_SPEC.label.paymentMethod
          : undefined,
        content: methodDescription,
      }),
    );
  }
  return stackImage(list);
}
