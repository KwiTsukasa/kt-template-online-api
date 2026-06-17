import { getBangDreamOperationsByHandlerName } from '@/modules/qqbot/plugins/bangdream/src/operations';

describe('BangDream operation catalog keys', () => {
  it('declares the catalog keys required by each operation', () => {
    const operations = getBangDreamOperationsByHandlerName();

    expectCatalogKeys(operations.get('searchSong')?.catalogKeys, [
      'songs',
      'meta',
      'singer',
      'bands',
      'characters',
      'events',
    ]);
    expectCatalogKeys(operations.get('getSongChart')?.catalogKeys, [
      'songs',
      'meta',
      'singer',
      'bands',
      'characters',
    ]);
    expectCatalogKeys(operations.get('randomSong')?.catalogKeys, [
      'songs',
      'meta',
      'singer',
      'bands',
      'characters',
    ]);
    expectCatalogKeys(operations.get('getSongMeta')?.catalogKeys, [
      'songs',
      'meta',
      'singer',
      'bands',
      'characters',
    ]);
    expectCatalogKeys(operations.get('searchCard')?.catalogKeys, [
      'cards',
      'skills',
      'characters',
      'singer',
      'bands',
      'events',
      'gacha',
      'costumes',
    ]);
    expectCatalogKeys(operations.get('getCardIllustration')?.catalogKeys, [
      'cards',
      'skills',
      'characters',
    ]);
    expectCatalogKeys(operations.get('searchCharacter')?.catalogKeys, [
      'characters',
      'singer',
      'bands',
    ]);
    expectCatalogKeys(operations.get('searchEvent')?.catalogKeys, [
      'events',
      'characters',
      'singer',
      'bands',
      'cards',
      'skills',
      'gacha',
      'songs',
      'meta',
      'degrees',
      'deco',
    ]);
    expectCatalogKeys(operations.get('getEventStage')?.catalogKeys, [
      'events',
      'characters',
      'songs',
      'meta',
    ]);
    expectCatalogKeys(operations.get('searchPlayer')?.catalogKeys, [
      'cards',
      'skills',
      'characters',
      'singer',
      'bands',
      'degrees',
      'areaItems',
    ]);
    expectCatalogKeys(operations.get('searchGacha')?.catalogKeys, [
      'gacha',
      'cards',
      'skills',
      'characters',
      'singer',
      'bands',
      'events',
      'items',
    ]);
    expectCatalogKeys(operations.get('simulateGacha')?.catalogKeys, [
      'gacha',
      'cards',
      'skills',
      'characters',
      'singer',
      'bands',
    ]);
    expectCatalogKeys(operations.get('getCutoffDetail')?.catalogKeys, [
      'events',
      'characters',
      'rates',
      'cards',
      'skills',
      'singer',
      'bands',
      'degrees',
    ]);
    expectCatalogKeys(operations.get('getCutoffAll')?.catalogKeys, [
      'events',
      'characters',
      'rates',
    ]);
    expectCatalogKeys(operations.get('getCutoffRecent')?.catalogKeys, [
      'events',
      'characters',
      'rates',
    ]);

    expect(operations.size).toBe(15);
  });
});

/**
 * 执行 BangDream 插件流程。
 * @param actual - actual 输入；构造测试断言。
 * @param keys - BangDream列表；构造测试断言。
 */
function expectCatalogKeys(
  actual: readonly string[] | undefined,
  keys: string[],
) {
  expect(actual).toEqual(keys);
}
