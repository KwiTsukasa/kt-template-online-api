import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import test from 'node:test';
import {
  chooseVideoFrames,
  normalizeVideoUrl,
  readVideo,
  validateVideoStream,
} from '../../../../src/modules/plugins/hermes-agent/assets/kt-video.mjs';

test('video URLs and media streams cannot target local files or arbitrary hosts', () => {
  assert.equal(
    normalizeVideoUrl(
      'https://www.bilibili.com/video/BV1hzt36WEEz/?spm_id=test',
    ),
    'https://www.bilibili.com/video/BV1hzt36WEEz',
  );
  assert.equal(
    normalizeVideoUrl('https://youtu.be/abcdefghijk?t=20'),
    'https://www.youtube.com/watch?v=abcdefghijk',
  );
  for (const url of [
    'file:///etc/passwd',
    'http://127.0.0.1',
    'https://bilibili.com.evil.test/video/BV1hzt36WEEz',
    'https://user:secret@www.bilibili.com/video/BV1hzt36WEEz',
  ])
    assert.throws(() => normalizeVideoUrl(url));
  assert.throws(() => validateVideoStream('https://127.0.0.1/video.mp4'));
  assert.throws(() =>
    validateVideoStream('https://bilivideo.com.evil.test/video.mp4'),
  );
  assert.equal(
    validateVideoStream('https://example.bilivideo.com/video.mp4'),
    'https://example.bilivideo.com/video.mp4',
  );
});

test('frame positions remain bounded and do not imply coverage of unobserved video', () => {
  assert.deepEqual(chooseVideoFrames(100), [0, 25, 50, 75]);
  assert.deepEqual(chooseVideoFrames(100, [20, 10, 10]), [10, 20]);
  assert.throws(() => chooseVideoFrames(100, [100]));
  assert.throws(() => chooseVideoFrames(Infinity));
});

test('extracts real file bytes into timestamped MCP images and cleans owned temporary files', async () => {
  const files = [];
  const commands = [];
  const execute = async (command, args) => {
    commands.push(command);
    if (command === 'yt-dlp')
      return JSON.stringify({
        duration: 30,
        protocol: 'https',
        url: 'https://example.bilivideo.com/video.mp4',
        title: '视频',
      });
    const file = args.at(-1);
    files.push(file);
    await writeFile(file, Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]));
    return '';
  };
  const content = await readVideo(
    { url: 'https://www.bilibili.com/video/BV1hzt36WEEz', timestamps: [5, 8] },
    execute,
  );
  assert.deepEqual(commands, ['yt-dlp', 'ffmpeg', 'ffmpeg']);
  assert.deepEqual(JSON.parse(content[0].text).timestamps, [5, 8]);
  assert.equal(JSON.parse(content[1].text).timestamp, 5);
  assert.equal(content[2].type, 'image');
  assert.deepEqual(
    Buffer.from(content[2].data, 'base64'),
    Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]),
  );
  for (const file of files) await assert.rejects(access(file));
});
