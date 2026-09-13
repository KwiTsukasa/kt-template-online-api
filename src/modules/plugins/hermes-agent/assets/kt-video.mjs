import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * 将公开视频地址收敛到支持的平台和视频标识，不接收文件、内网或任意下载地址。
 * @param value - 用户提供的完整公开视频链接。
 * @returns 去除追踪参数、凭据和无关路径的规范视频地址。
 * @throws 地址不属于支持的视频平台或缺少视频标识时拒绝读取。
 */
export function normalizeVideoUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('视频必须使用公开平台的HTTPS链接');
  if (
    ['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(
      url.hostname,
    )
  ) {
    const id = url.pathname.match(
      /^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/u,
    )?.[1];
    if (id) {
      const target = new URL(`https://www.bilibili.com/video/${id}`);
      const part = url.searchParams.get('p');
      if (part && /^\d{1,3}$/u.test(part)) target.searchParams.set('p', part);
      return target.toString();
    }
  }
  let id = '';
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  if (
    ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
  ) {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else
      id =
        url.pathname.match(
          /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/u,
        )?.[1] || '';
  }
  if (/^[A-Za-z0-9_-]{11}$/u.test(id))
    return `https://www.youtube.com/watch?v=${id}`;
  throw new Error('目前可读取Bilibili或YouTube的公开视频直链');
}

/**
 * 校验抽帧时间并在未指定时分散抽取四帧，记录实际观察范围。
 * @param duration - 视频元数据确认的总秒数。
 * @param requested - 模型根据问题指定的最多八个秒级时间点。
 * @returns 排序去重后的实际抽帧时间。
 * @throws 直播、无有效时长或时间点越界时拒绝抽帧。
 */
export function chooseVideoFrames(duration, requested) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 14400)
    throw new Error('只读取时长已知且不超过四小时的已发布视频');
  if (
    requested !== undefined &&
    (!Array.isArray(requested) || !requested.length || requested.length > 8)
  )
    throw new Error('每次提供1至8个时间点');
  const times = requested || [
    0,
    duration * 0.25,
    duration * 0.5,
    duration * 0.75,
  ];
  if (
    times.some(
      (value) => !Number.isFinite(value) || value < 0 || value >= duration,
    )
  )
    throw new Error('抽帧时间超出视频范围');
  return [...new Set(times.map((value) => Math.floor(value * 100) / 100))].sort(
    (a, b) => a - b,
  );
}

/**
 * 限制解码器只能读取已知视频平台CDN上的单一HTTPS媒体流。
 * @param value - 视频解析器返回的媒体地址。
 * @returns 通过平台域名校验的实际地址。
 * @throws 非媒体域名、账号凭据或非HTTPS地址不交给解码器。
 */
export function validateVideoStream(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !/(?:^|\.)(?:bilivideo\.com|bilivideo\.cn|bilivideo\.net|googlevideo\.com)$/u.test(
      url.hostname,
    )
  ) {
    throw new Error('解析结果不是受支持的视频媒体流');
  }
  return url.toString();
}

/**
 * 在NAS执行固定媒体命令，不解释shell输入，限制执行时间和输出大小。
 * @param command - 已安装的视频解析或解码程序。
 * @param args - 代码生成并验证的独立参数。
 * @param timeout - 本步骤的最长运行毫秒数。
 * @returns 媒体程序成功退出后的标准输出。
 * @throws 程序缺失、超时或平台拒绝时保留可定位的步骤错误。
 */
async function runMediaCommand(command, args, timeout) {
  try {
    const result = await exec(command, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    let reason = '平台未提供可读取的媒体或解码失败';
    if (error?.code === 'ENOENT') reason = 'NAS未安装媒体读取依赖';
    else if (error?.killed) reason = '媒体读取超时';
    throw new Error(`${command}：${reason}`);
  }
}

/**
 * 从真实视频流提取带时间点的画面，并以MCP图片块交给视觉模型。
 * @param input - 公开视频地址及本次需要查看的时间点。
 * @param execute - 默认使用NAS媒体程序，验证时可注入受控执行器。
 * @returns 真实视频元数据、抽帧范围与图像块；不把简介当视频内容。
 * @throws 平台拒绝、没有公开媒体流、画面过大或抽帧失败时明确停止本次读取。
 */
export async function readVideo(input, execute = runMediaCommand) {
  const source = normalizeVideoUrl(input.url);
  const raw = await execute(
    'yt-dlp',
    [
      '--ignore-config',
      '--no-cache-dir',
      '--no-playlist',
      '--no-warnings',
      '--no-colors',
      '--socket-timeout',
      '12',
      '--retries',
      '1',
      '--extractor-retries',
      '1',
      '--skip-download',
      '--dump-single-json',
      '--format',
      'bv*[protocol=https][ext=mp4][height<=720]/b[protocol=https][ext=mp4]',
      '--',
      source,
    ],
    40000,
  );
  const metadata = JSON.parse(raw);
  if (metadata.is_live || metadata._type === 'playlist')
    throw new Error('不读取直播或视频合集，请提供单个已发布视频');
  const times = chooseVideoFrames(metadata.duration, input.timestamps);
  if (!metadata.url || metadata.protocol !== 'https')
    throw new Error(
      '平台没有提供公开的单文件视频流；当前只有元数据，未读取画面',
    );
  const stream = validateVideoStream(metadata.url);
  const directory = await mkdtemp(join(tmpdir(), 'kt-video-'));
  const content = [];
  let bytes = 0;
  try {
    for (const [index, timestamp] of times.entries()) {
      const file = join(directory, `frame-${index}.jpg`);
      const args = [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'https,tls,tcp',
        '-rw_timeout',
        '12000000',
      ];
      const userAgent = metadata.http_headers?.['User-Agent'];
      if (
        typeof userAgent === 'string' &&
        userAgent.length <= 512 &&
        !/[\r\n]/u.test(userAgent)
      )
        args.push('-user_agent', userAgent);
      if (source.includes('bilibili.com')) args.push('-referer', source);
      args.push(
        '-ss',
        String(timestamp),
        '-i',
        stream,
        '-frames:v',
        '1',
        '-an',
        '-sn',
        '-vf',
        'scale=1280:-2:force_original_aspect_ratio=decrease',
        '-q:v',
        '3',
        '-y',
        file,
      );
      await execute('ffmpeg', args, 16000);
      const image = await readFile(file);
      bytes += image.length;
      if (image[0] !== 0xff || image[1] !== 0xd8 || bytes > 6 * 1024 * 1024)
        throw new Error('抽取画面无效或超过单次图像上限');
      content.push({
        type: 'text',
        text: JSON.stringify({ source, timestamp, frameIndex: index }),
      });
      content.push({
        type: 'image',
        mimeType: 'image/jpeg',
        data: image.toString('base64'),
      });
    }
    content.unshift({
      type: 'text',
      text: JSON.stringify({
        source,
        title: metadata.title,
        uploader: metadata.uploader,
        duration: metadata.duration,
        retrievedAt: new Date().toISOString(),
        timestamps: times,
        coverage:
          '仅包含所列时间点的真实画面；未读取其余画面和音频。需要其他片段时指定时间点继续读取。',
      }),
    });
    return content;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
