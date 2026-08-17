import { drawList } from '@/modules/qqbot/plugins/bangdream/src/theme/list-frame.renderer';
import { Gacha } from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha.model';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { Item } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/item.model';
import { stackImage } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import {
  BANGDREAM_GACHA_LIST_SPEC,
  getGachaPaymentBehaviorLabel,
} from '@/modules/qqbot/plugins/bangdream/src/domain/gacha/gacha-list.layout';

/**
 * 根据`gacha`绘制或格式化GashaPaymentMethod；从 `item.getItemImage` 读取GashaPaymentMethod。
 * @param gacha - 用于GashaPaymentMethod的领域对象，包含 `paymentMethods` 字段。
 * @returns 按支付方式顺序叠加物品图标、数量与行为说明后的卡池支付画布。
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
        key: (() => {
          if (isFirst) {
            return BANGDREAM_GACHA_LIST_SPEC.label.paymentMethod;
          }
          return undefined;
        })(),
        content: methodDescription,
      }),
    );
  }
  return stackImage(list);
}
