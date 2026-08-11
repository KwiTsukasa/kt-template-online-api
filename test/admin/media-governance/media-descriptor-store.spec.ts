import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import {
  MEDIA_DESCRIPTOR_PRIVATE_BUCKET,
  MediaDescriptorStore,
} from '../../../src/modules/admin/media-governance/media-descriptor.store';
import { parseTorrentDescriptor } from '../../../src/modules/admin/media-governance/media-torrent-descriptor';

const torrentFixture = Buffer.from(
  'd8:announce23:https://tracker.invalid4:infod6:lengthi4e4:name8:demo.mkvee',
);

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
});
