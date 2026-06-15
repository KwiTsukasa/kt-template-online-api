describe('BangDream remote resource client', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('does not poison png url cache after transient network failures', async () => {
    const imageBuffer = Buffer.from('png-data');
    const requestArrayBuffer = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout of 8000ms exceeded'))
      .mockResolvedValueOnce({ body: imageBuffer, headers: {} });

    const { configureBangDreamRuntimeIo } = await import(
      '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io'
    );
    configureBangDreamRuntimeIo({ requestArrayBuffer });
    const { fetchRemoteResourceBuffer } =
      await import('@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/remote-resource.client');

    await expect(
      fetchRemoteResourceBuffer('https://example.com/card.png'),
    ).rejects.toThrow('timeout of 8000ms exceeded');
    await expect(
      fetchRemoteResourceBuffer('https://example.com/card.png'),
    ).resolves.toEqual(imageBuffer);
    expect(requestArrayBuffer).toHaveBeenCalledTimes(2);
  });

  it('keeps missing png urls in the error cache', async () => {
    const notFoundError = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    const requestArrayBuffer = jest.fn().mockRejectedValueOnce(notFoundError);

    const { configureBangDreamRuntimeIo } = await import(
      '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io'
    );
    configureBangDreamRuntimeIo({ requestArrayBuffer });
    const { fetchRemoteResourceBuffer } =
      await import('@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/remote-resource.client');

    await expect(
      fetchRemoteResourceBuffer('https://example.com/missing.png'),
    ).rejects.toThrow('not found');
    await expect(
      fetchRemoteResourceBuffer('https://example.com/missing.png'),
    ).rejects.toThrow('errorUrlCache includes url');
    expect(requestArrayBuffer).toHaveBeenCalledTimes(1);
  });

  it('keeps missing svg urls in the error cache', async () => {
    const notFoundError = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    const requestArrayBuffer = jest.fn().mockRejectedValueOnce(notFoundError);

    const { configureBangDreamRuntimeIo } = await import(
      '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io'
    );
    configureBangDreamRuntimeIo({ requestArrayBuffer });
    const { fetchRemoteResourceBuffer } =
      await import('@/modules/qqbot/plugins/bangdream/src/infrastructure/storage/remote-resource.client');

    await expect(
      fetchRemoteResourceBuffer('https://example.com/missing.svg'),
    ).rejects.toThrow('not found');
    await expect(
      fetchRemoteResourceBuffer('https://example.com/missing.svg'),
    ).rejects.toThrow('errorUrlCache includes url');
    expect(requestArrayBuffer).toHaveBeenCalledTimes(1);
  });
});
