import { parseQqbotFf14MarketPriceInput } from '../../../../src/modules/qqbot/plugins/ff14-market/src';
import { parseQqbotFflogsCharacterInput } from '../../../../src/modules/qqbot/plugins/fflogs/src';

const ff14Catalog = {
  dataCenters: [
    {
      name: '猫小胖',
      region: '国服',
      worlds: ['宇宙和音', '延夏'],
    },
  ],
  defaultRegion: '国服',
  regions: ['国服'],
};

describe('QQBot built-in plugin input parsers', () => {
  it('keeps FF14 market price parsing inside the FF14 plugin package', () => {
    expect(
      parseQqbotFf14MarketPriceInput('柔韧鲫鱼 猫小胖 宇宙和音 hq', ff14Catalog),
    ).toMatchObject({
      dataCenter: '猫小胖',
      hq: true,
      item: '柔韧鲫鱼',
      language: 'chs',
      raw: '柔韧鲫鱼 猫小胖 宇宙和音 hq',
      region: '',
      world: '宇宙和音',
    });
  });

  it('keeps FFLogs character parsing inside the FFLogs plugin package', () => {
    expect(
      parseQqbotFflogsCharacterInput('Kwi 宇宙和音 阿尔卡迪亚', {
        resolveKnownWorld: (value) =>
          value === '宇宙和音' ? { serverSlug: value } : null,
      }),
    ).toMatchObject({
      characterName: 'Kwi',
      encounterName: '阿尔卡迪亚',
      raw: 'Kwi 宇宙和音 阿尔卡迪亚',
      serverSlug: '宇宙和音',
      text: 'Kwi 宇宙和音 阿尔卡迪亚',
    });
  });
});
