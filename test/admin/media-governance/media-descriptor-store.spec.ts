import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import {
  MEDIA_DESCRIPTOR_PRIVATE_BUCKET,
  MediaDescriptorStore,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-descriptor.store';
import { parseTorrentDescriptor } from '../../../src/modules/admin/media-governance/domain/media-torrent-descriptor';

const torrentFixture = Buffer.from(
  'd8:announce23:https://tracker.invalid4:infod6:lengthi4e4:name8:demo.mkvee',
);

function bencode(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) {
    return Buffer.concat([
      Buffer.from('l'),
      ...value.map(bencode),
      Buffer.from('e'),
    ]);
  }
  const record = value as Record<string, unknown>;
  return Buffer.concat([
    Buffer.from('d'),
    ...Object.keys(record)
      .sort()
      .flatMap((key) => [bencode(Buffer.from(key)), bencode(record[key])]),
    Buffer.from('e'),
  ]);
}

describe('media torrent descriptor boundary', () => {
  it('derives the info hash and a safe manifest without exposing the tracker', () => {
    const parsed = parseTorrentDescriptor(torrentFixture);

    expect(parsed.infoHash).toMatch(/^[a-f\d]{40}$/);
    expect(parsed.manifest).toEqual([
      {
        executable: false,
        index: 0,
        relativePath: 'demo.mkv',
        sizeBytes: 4,
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain('tracker.invalid');
  });

  it('excludes padding transport entries and matches qBittorrent visible indices', () => {
    const parsed = parseTorrentDescriptor(
      bencode({
        info: {
          files: [
            { length: 4, path: [Buffer.from('demo-01.mkv')] },
            {
              attr: Buffer.from('p'),
              length: 2,
              path: [Buffer.from('padding.bin')],
            },
            { length: 5, path: [Buffer.from('demo-02.mkv')] },
          ],
          name: Buffer.from('demo'),
        },
      }),
    );

    expect(parsed.manifest).toEqual([
      {
        executable: false,
        index: 0,
        relativePath: 'demo-01.mkv',
        sizeBytes: 4,
      },
      {
        executable: false,
        index: 1,
        relativePath: 'demo-02.mkv',
        sizeBytes: 5,
      },
    ]);
  });

  it('stores immutable descriptors only in the private bucket', async () => {
    const client = {
      bucketExists: jest.fn(async () => false),
      makeBucket: jest.fn(async () => undefined),
      putObject: jest.fn(async () => ({ etag: 'private-etag' })),
    };
    const store = new MediaDescriptorStore(
      { client } as unknown as MinioService,
      { get: jest.fn(() => undefined) } as unknown as ConfigService,
    );

    const result = await store.putTorrentDescriptor({
      bytes: torrentFixture,
      revision: 1,
      sourceId: 'media-source-01',
      taskId: 'media-task-01',
    });

    expect(client.makeBucket).toHaveBeenCalledWith(
      MEDIA_DESCRIPTOR_PRIVATE_BUCKET,
      'us-east-1',
    );
    expect(client.putObject).toHaveBeenCalledWith(
      MEDIA_DESCRIPTOR_PRIVATE_BUCKET,
      expect.stringMatching(
        /^tasks\/media-task-01\/sources\/media-source-01\/revisions\/1-[a-f\d]{64}\.torrent$/,
      ),
      torrentFixture,
      torrentFixture.length,
      expect.objectContaining({ 'Content-Type': 'application/x-bittorrent' }),
    );
    expect(result).toMatchObject({
      bytes: torrentFixture.length,
      descriptorSha256: createHash('sha256')
        .update(torrentFixture)
        .digest('hex'),
      infoHash: expect.stringMatching(/^[a-f\d]{40}$/),
    });
    expect(result).not.toHaveProperty('bucketName');
    expect(result).not.toHaveProperty('url');
  });

  it('redeems an immutable descriptor by object identity and digest without a URL', async () => {
    const descriptorSha256 = createHash('sha256')
      .update(torrentFixture)
      .digest('hex');
    const objectId = `tasks/media-task-01/sources/media-source-01/revisions/1-${descriptorSha256}.torrent`;
    const client = {
      getObject: jest.fn(async () => Readable.from([torrentFixture])),
    };
    const store = new MediaDescriptorStore(
      { client } as unknown as MinioService,
      { get: jest.fn(() => undefined) } as unknown as ConfigService,
    );

    const result = await store.readDescriptor({
      descriptorSha256,
      objectId,
    });

    expect(result).toEqual(torrentFixture);
    expect(client.getObject).toHaveBeenCalledWith(
      MEDIA_DESCRIPTOR_PRIVATE_BUCKET,
      objectId,
    );
  });

  it('rejects path escape, oversized data and digest drift while redeeming', async () => {
    const store = new MediaDescriptorStore(
      {
        client: {
          getObject: jest.fn(async () =>
            Readable.from([Buffer.alloc(2 * 1024 * 1024 + 1)]),
          ),
        },
      } as unknown as MinioService,
      { get: jest.fn(() => undefined) } as unknown as ConfigService,
    );

    await expect(
      store.readDescriptor({
        descriptorSha256: '0'.repeat(64),
        objectId: '../private.torrent',
      }),
    ).rejects.toThrow('descriptor-object-id-invalid');
    await expect(
      store.readDescriptor({
        descriptorSha256: '0'.repeat(64),
        objectId: `tasks/media-task-01/sources/media-source-01/revisions/1-${'0'.repeat(64)}.torrent`,
      }),
    ).rejects.toThrow('descriptor-size-invalid');
  });
});
