describe('BangDream catalog cache partial loading', () => {
  it('loads only requested catalog keys and their matching static patches', async () => {
    const getJson = jest.fn<
      Promise<Record<string, { path: string }>>,
      [string, { cacheTime?: number }?]
    >(async (path) => ({
      1: { path },
    }));
    const readJson = jest.fn(async () => ({}));
    const readExcelRows = jest.fn(async () => []);

    jest.resetModules();
    jest.doMock(
      '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider',
      () => ({
        bangdreamBestdoriProvider: {
          getJson,
        },
      }),
    );
    jest.doMock(
      '@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/static-patch.provider',
      () => ({
        bangdreamStaticPatchProvider: {
          readExcelRows,
          readJson,
        },
      }),
    );
    jest.doMock(
      '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger',
      () => ({
        logger: jest.fn(),
      }),
    );
    jest.doMock(
      '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io',
      () => ({
        readBangDreamRuntimeConfig: jest.fn(() => undefined),
        sleepBangDreamRuntime: jest.fn(() => new Promise(() => undefined)),
      }),
    );

    const { BANGDREAM_BESTDORI_API_PATHS } = await import(
      '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol'
    );
    const { waitForBangDreamCatalogReady } = await import(
      '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache'
    );

    await waitForBangDreamCatalogReady(['songs', 'meta']);

    expect(getJson).toHaveBeenCalledTimes(2);
    expect(getJson.mock.calls.map(([path]) => path).sort()).toEqual(
      [
        BANGDREAM_BESTDORI_API_PATHS.meta,
        BANGDREAM_BESTDORI_API_PATHS.songs,
      ].sort(),
    );
    expect(readJson).not.toHaveBeenCalled();
    expect(readExcelRows).toHaveBeenCalledTimes(1);
  });
});
