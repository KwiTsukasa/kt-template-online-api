import { createHash } from 'node:crypto';
import { Canvas, loadImage } from 'skia-canvas';

/**
 * 解码有大小限制的图片并规范成正方形 PNG，去除元数据且固定上传尺寸。
 * @param bytes - QQ 附件字节或官方头像读回字节。
 * @param size - 目标边长；头像保存用五百一十二，比较用六十四。
 * @returns 规范化画布与 PNG 编码。
 * @throws 图片签名、尺寸或解码不满足边界时拒绝处理。
 */
export async function normalizeAvatar(bytes: Buffer, size = 512) {
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP';
  if (
    !bytes.length ||
    bytes.length > 2 * 1024 * 1024 ||
    (!png && !jpeg && !webp)
  )
    throw new Error('头像格式或大小无效。');
  assertEncodedDimensions(bytes, png, jpeg);
  const image = await loadImage(bytes);
  if (
    !image.width ||
    !image.height ||
    image.width > 4096 ||
    image.height > 4096
  )
    throw new Error('头像尺寸无效。');
  const canvas = new Canvas(size, size);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  const side = Math.min(image.width, image.height);
  context.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  return { canvas, png: await canvas.toBuffer('png') };
}

/**
 * 在原生解码之前读取图像头尺寸，阻止小压缩文件申请超大像素缓冲区。
 * @param bytes - 已核对签名的 PNG、JPEG 或 WebP 字节。
 * @param png - 是否具有 PNG 签名。
 * @param jpeg - 是否具有 JPEG 签名。
 * @throws 图片头损坏、尺寸缺失或超过四千零九十六像素时拒绝解码。
 */
function assertEncodedDimensions(
  bytes: Buffer,
  png: boolean,
  jpeg: boolean,
): void {
  let width = 0,
    height = 0;
  if (png && bytes.length >= 24 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (jpeg) {
    let offset = 2;
    const frames = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length)
        break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (frames.has(marker) && length >= 7) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (bytes.length >= 30 && bytes.toString('ascii', 12, 16) === 'VP8X') {
    width = bytes.readUIntLE(24, 3) + 1;
    height = bytes.readUIntLE(27, 3) + 1;
  } else if (
    bytes.length >= 25 &&
    bytes.toString('ascii', 12, 16) === 'VP8L' &&
    bytes[20] === 0x2f
  ) {
    width = 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff);
    height =
      1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 0x3fff);
  } else if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 12, 16) === 'VP8 ' &&
    bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
  ) {
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  }
  if (!width || !height || width > 4096 || height > 4096)
    throw new Error('头像尺寸或图片头无效。');
}

/**
 * 对规范化头像建立不可变内容身份，避免依赖会过期的下载 URL。
 * @param bytes - 已规范化的 PNG 字节。
 * @returns 小写 SHA-256 内容摘要。
 */
export function imageHash(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 在相同尺寸下比较头像像素，容忍官方重新编码产生的小幅色差。
 * @param expected - 用户保存的头像。
 * @param actual - 从 Bot 当前公开头像读取的图片。
 * @returns 是否满足像素均方差上限。
 */
export async function avatarsMatch(
  expected: Buffer,
  actual: Buffer,
): Promise<boolean> {
  const left = (await normalizeAvatar(expected, 64)).canvas
    .getContext('2d')
    .getImageData(0, 0, 64, 64).data;
  const right = (await normalizeAvatar(actual, 64)).canvas
    .getContext('2d')
    .getImageData(0, 0, 64, 64).data;
  let error = 0;
  for (let index = 0; index < left.length; index++)
    error += (left[index] - right[index]) ** 2;
  return Math.sqrt(error / left.length) <= 3;
}

/**
 * 将浏览器新二维码放入灰度相机帧，使用整数最近邻缩放保留识别边缘。
 * @param bytes - 当前会话二维码 PNG。
 * @returns 六百四十乘四百八十的 GRAY8 帧。
 */
export async function qrCameraFrame(bytes: Buffer): Promise<Buffer> {
  const image = await loadImage(bytes);
  const canvas = new Canvas(640, 480);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 640, 480);
  context.imageSmoothingEnabled = false;
  const scale = Math.max(
    1,
    Math.floor(400 / Math.max(image.width, image.height)),
  );
  const width = image.width * scale,
    height = image.height * scale;
  context.drawImage(
    image,
    (640 - width) / 2,
    (480 - height) / 2,
    width,
    height,
  );
  const rgba = context.getImageData(0, 0, 640, 480).data;
  const result = Buffer.alloc(640 * 480);
  for (let index = 0; index < result.length; index++)
    result[index] = Math.round(
      (rgba[index * 4] + rgba[index * 4 + 1] + rgba[index * 4 + 2]) / 3,
    );
  return result;
}
