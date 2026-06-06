describe('BangDream file cache client', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('does not poison png url cache after transient network failures', async () => {
    const imageBuffer = Buffer.from('png-data');
    const get = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout of 8000ms exceeded'))
      .mockResolvedValueOnce({ data: imageBuffer, headers: {} });

    jest.doMock('axios', () => ({
      __esModule: true,
      default: { get },
    }));

    const { download } =
      await import('@/qqbot/plugins/bangDream/tsugu/data-clients/file-cache-client');

    await expect(download('https://example.com/card.png')).rejects.toThrow(
      'timeout of 8000ms exceeded',
    );
    await expect(download('https://example.com/card.png')).resolves.toEqual(
      imageBuffer,
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps missing png urls in the error cache', async () => {
    const notFoundError = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    const get = jest.fn().mockRejectedValueOnce(notFoundError);

    jest.doMock('axios', () => ({
      __esModule: true,
      default: { get },
    }));

    const { download } =
      await import('@/qqbot/plugins/bangDream/tsugu/data-clients/file-cache-client');

    await expect(download('https://example.com/missing.png')).rejects.toThrow(
      'not found',
    );
    await expect(download('https://example.com/missing.png')).rejects.toThrow(
      'errorUrlCache includes url',
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps missing svg urls in the error cache', async () => {
    const notFoundError = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    const get = jest.fn().mockRejectedValueOnce(notFoundError);

    jest.doMock('axios', () => ({
      __esModule: true,
      default: { get },
    }));

    const { download } =
      await import('@/qqbot/plugins/bangDream/tsugu/data-clients/file-cache-client');

    await expect(download('https://example.com/missing.svg')).rejects.toThrow(
      'not found',
    );
    await expect(download('https://example.com/missing.svg')).rejects.toThrow(
      'errorUrlCache includes url',
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
});
