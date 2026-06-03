import {
  buildQqbotFf14MarketCatalog,
  resolveQqbotFf14MarketTarget,
} from './qqbot-ff14-worlds';

describe('qqbot ff14 market worlds', () => {
  const catalog = buildQqbotFf14MarketCatalog({
    dataCenters: [
      { childrenCode: '中国', label: '猫小胖', value: '猫小胖' },
      { childrenCode: '中国', label: '陆行鸟', value: '陆行鸟' },
    ],
    regions: [{ label: '中国', value: '中国' }],
    worlds: [
      { childrenCode: '猫小胖', label: '琥珀原', value: '琥珀原' },
      { childrenCode: '陆行鸟', label: '红玉海', value: '红玉海' },
    ],
  });

  it('resolves world labels from dict catalog', () => {
    expect(resolveQqbotFf14MarketTarget(catalog, { world: '琥珀原' })).toEqual({
      dataCenter: '猫小胖',
      label: '中国 / 猫小胖 / 琥珀原',
      region: '中国',
      target: '琥珀原',
      world: '琥珀原',
    });
  });

  it('rejects world and data center mismatch from dict catalog', () => {
    expect(() =>
      resolveQqbotFf14MarketTarget(catalog, {
        dataCenter: '陆行鸟',
        world: '琥珀原',
      }),
    ).toThrow('服务器 琥珀原 不属于大区 陆行鸟');
  });
});
