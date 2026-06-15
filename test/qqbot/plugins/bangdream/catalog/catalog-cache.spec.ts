const mockGetJson = jest.fn<
  Promise<Record<string, { path: string }>>,
  [string, { cacheTime?: number }?]
>(async (path) => ({
  1: { path },
}));
const mockReadJson = jest.fn(async () => ({}));
const mockReadExcelRows = jest.fn(async () => []);
const mockLog = jest.fn();

jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider',
  () => ({
    bangdreamBestdoriProvider: {
      getJson: mockGetJson,
    },
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/static-patch.provider',
  () => ({
    bangdreamStaticPatchProvider: {
      readExcelRows: mockReadExcelRows,
      readJson: mockReadJson,
    },
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger',
  () => ({
    logger: mockLog,
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io',
  () => ({
    readBangDreamRuntimeConfig: jest.fn(() => undefined),
    sleepBangDreamRuntime: jest.fn(() => new Promise(() => undefined)),
  }),
);

import { waitForBangDreamCatalogReady } from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';
import { BANGDREAM_BESTDORI_API_PATHS } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';

describe('BangDream catalog cache', () => {
  beforeEach(() => {
    mockGetJson.mockClear();
    mockReadJson.mockClear();
    mockReadExcelRows.mockClear();
    mockLog.mockClear();
  });

  it('loads each Bestdori catalog path only once during the initial ready wait', async () => {
    await waitForBangDreamCatalogReady!();

    const catalogPaths = Object.values(BANGDREAM_BESTDORI_API_PATHS);
    expect(mockGetJson).toHaveBeenCalledTimes(catalogPaths.length);
    expect(mockGetJson.mock.calls.map(([path]) => path).sort()).toEqual(
      [...catalogPaths].sort(),
    );
    expect(
      mockGetJson.mock.calls.every(
        ([, options]) => options?.cacheTime === 1 / 0,
      ),
    ).toBe(true);
    expect(mockReadJson).toHaveBeenCalledTimes(3);
    expect(mockReadExcelRows).toHaveBeenCalledTimes(1);
  });
});
