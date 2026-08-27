import { createHash } from 'node:crypto';

import { parseTorrentDescriptor } from '../../../src/modules/admin/media-governance/domain/media-torrent-descriptor';

describe('media torrent descriptor direct subtitle web-seed', () => {
  const payload = Buffer.from(
    '[Script Info]\nTitle: Spider-Man Brand New Day\n[Events]\n',
  );
  const fileName = 'Spider-Man.Brand.New.Day.2026.DKS.zh-CN.ass';
  const torrent = (url: string, directPayload = payload) => {
    const name = Buffer.from(fileName);
    const webSeed = Buffer.from(url);
    return Buffer.concat([
      Buffer.from(`d4:infod6:lengthi${payload.length}e4:name${name.length}:`),
      name,
      Buffer.from('12:piece lengthi16384e6:pieces20:'),
      createHash('sha1').update(payload).digest(),
      Buffer.from(`e17:kt-direct-payload${directPayload.length}:`),
      directPayload,
      Buffer.from(`8:url-list${webSeed.length}:`),
      webSeed,
      Buffer.from('e'),
    ]);
  };

  it('seals one HTTPS Assrt subtitle against its torrent piece hash', () => {
    const descriptor = torrent(
      `https://2.assrt.net/download/731553/-/2/${fileName}`,
    );

    expect(parseTorrentDescriptor(descriptor).directSubtitleWebSeed).toEqual({
      payload,
      pieceLength: 16 * 1024,
      pieceSha1: [createHash('sha1').update(payload).digest('hex')],
      urls: [`https://2.assrt.net/download/731553/-/2/${fileName}`],
    });
  });

  it('rejects a torrent web-seed outside the fixed Assrt HTTPS route', () => {
    expect(() =>
      parseTorrentDescriptor(torrent('http://127.0.0.1/private.ass')),
    ).toThrow('torrent-descriptor-web-seed-invalid');
  });

  it('rejects an inline subtitle whose bytes drift from the torrent pieces', () => {
    const tamperedPayload = Buffer.from(payload);
    tamperedPayload[0] ^= 0xff;

    expect(() =>
      parseTorrentDescriptor(
        torrent(
          `https://2.assrt.net/download/731553/-/2/${fileName}`,
          tamperedPayload,
        ),
      ),
    ).toThrow('torrent-descriptor-direct-payload-invalid');
  });
});
