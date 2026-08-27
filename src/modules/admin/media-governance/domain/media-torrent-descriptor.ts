import { createHash } from 'node:crypto';
import { validateDescriptorManifestEntry } from './media-governance-domain';

const MAX_DESCRIPTOR_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_NESTING_DEPTH = 64;
const DIRECT_SUBTITLE_SUFFIX = /\.(?:ass|ssa|srt|vtt)$/iu;
const ASSRT_WEB_SEED_PATH = /^\/download\/\d{1,12}\/-\/\d{1,6}\/[^/]+\.(?:ass|ssa|srt|vtt)$/iu;

type BencodeValue =
  | Buffer
  | Map<string, BencodeValue>
  | BencodeValue[]
  | number;

type ManifestEntry = {
  executable: boolean;
  index: number;
  relativePath: string;
  sizeBytes: number;
};

class BencodeParser {
  infoRange: null | { end: number; start: number } = null;
  private offset = 0;

  constructor(private readonly bytes: Buffer) {}

  /**
   * 解析完整 Bencode 根字典，并拒绝尾随字节。
   * @returns 根目录。
   * @throws 当 `!(root instanceof Map) || this.offset !== this.bytes.length` 成立时拒绝当前输入并抛出 `Error`。
   */
  parseRoot(): Map<string, BencodeValue> {
    const root = this.parseValue(true, 0);
    if (!(root instanceof Map) || this.offset !== this.bytes.length) {
      throw new Error('torrent-descriptor-root-invalid');
    }
    return root;
  }

  /**
   * 按当前字节类型解析值，同时限制递归深度。
   * @param rootDictionary - 决定值内容、边界或目标的 `rootDictionary` 值；省略时默认采用 `false`。
   * @param depth - 决定值内容、边界或目标的 `depth` 值；省略时默认采用 `0`。
   * @returns 值。
   * @throws 当 `depth > MAX_NESTING_DEPTH` 成立时拒绝当前输入并抛出 `Error`；当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `Error`。
   */
  private parseValue(rootDictionary = false, depth = 0): BencodeValue {
    if (depth > MAX_NESTING_DEPTH) {
      throw new Error('torrent-descriptor-nesting-invalid');
    }
    const token = this.bytes[this.offset];
    if (token === 0x64) return this.parseDictionary(rootDictionary, depth);
    if (token === 0x6c) return this.parseList(depth);
    if (token === 0x69) return this.parseInteger();
    if (token !== undefined && token >= 0x30 && token <= 0x39) {
      return this.parseBytes();
    }
    throw new Error('torrent-descriptor-bencode-invalid');
  }

  /**
   * 解析字典并记录根级 info 值的原始字节区间。
   * @param rootDictionary - 决定字典并记录根级 info 值的原始字节区间内容、边界或目标的 `rootDictionary` 值。
   * @param depth - 决定字典并记录根级 info 值的原始字节区间内容、边界或目标的 `depth` 值。
   * @returns 字典并记录根级 info 值的原始字节区间。
   * @throws 当 `!key || result.has(key)` 成立时拒绝当前输入并抛出 `Error`；当 `this.offset >= this.bytes.length` 成立时拒绝当前输入并抛出 `Error`。
   */
  private parseDictionary(
    rootDictionary: boolean,
    depth: number,
  ): Map<string, BencodeValue> {
    this.offset += 1;
    const result = new Map<string, BencodeValue>();
    while (this.bytes[this.offset] !== 0x65) {
      const keyBytes = this.parseBytes();
      const key = keyBytes.toString('utf8');
      if (!key || result.has(key)) {
        throw new Error('torrent-descriptor-dictionary-invalid');
      }
      const valueStart = this.offset;
      const value = this.parseValue(false, depth + 1);
      if (rootDictionary && key === 'info') {
        this.infoRange = { end: this.offset, start: valueStart };
      }
      result.set(key, value);
      if (this.offset >= this.bytes.length) {
        throw new Error('torrent-descriptor-bencode-invalid');
      }
    }
    this.offset += 1;
    return result;
  }

  /**
   * 根据参数 `depth`，解析有界列表并拒绝未终止或超量条目。
   * @param depth - 决定根据参数 `depth`，解析有界列表并拒绝未终止或超量条目内容、边界或目标的 `depth` 值。
   * @returns 按输入顺序得到的根据参数 `depth`，解析有界列表并拒绝未终止或超量条目列表；没有匹配项时为空数组。
   * @throws 当 `result.length > MAX_FILES || this.offset >= this.bytes.length` 成立时拒绝当前输入并抛出 `Error`。
   */
  private parseList(depth: number): BencodeValue[] {
    this.offset += 1;
    const result: BencodeValue[] = [];
    while (this.bytes[this.offset] !== 0x65) {
      result.push(this.parseValue(false, depth + 1));
      if (result.length > MAX_FILES || this.offset >= this.bytes.length) {
        throw new Error('torrent-descriptor-list-invalid');
      }
    }
    this.offset += 1;
    return result;
  }

  /**
   * 根据当前领域状态，解析符合 Bencode 规范且可安全表示的整数。
   * @returns 根据当前领域状态，解析符合 Bencode 规范且可安全表示的整数。
   * @throws 当 `end === -1` 成立时拒绝当前输入并抛出 `Error`；当 `!/^(0|-?[1-9]\d*)$/.test(valueText)` 成立时拒绝当前输入并抛出 `Error`；当 `!Number.isSafeInteger(value)` 成立时拒绝当前输入并抛出 `Error`。
   */
  private parseInteger(): number {
    this.offset += 1;
    const end = this.bytes.indexOf(0x65, this.offset);
    if (end === -1) throw new Error('torrent-descriptor-integer-invalid');
    const valueText = this.bytes.subarray(this.offset, end).toString('ascii');
    if (!/^(0|-?[1-9]\d*)$/.test(valueText)) {
      throw new Error('torrent-descriptor-integer-invalid');
    }
    const value = Number(valueText);
    if (!Number.isSafeInteger(value)) {
      throw new Error('torrent-descriptor-integer-invalid');
    }
    this.offset = end + 1;
    return value;
  }

  /**
   * 从当前 Bencode 缓冲区解析长度前缀字节串并推进偏移；长度格式、范围或剩余字节不合法时拒绝输入。
   * @returns 返回 `bytes.subarray` 的调用结果，其业务含义为长度前缀字节串并推进读取偏移。
   * @throws 当 `separator === -1` 成立时抛出 `Error`；当 `!/^(0|[1-9]\d*)$/.test(lengthText)` 成立时抛出 `Error`；当 `!Number.isSafeInteger(length) || end > this.bytes.length` 成立时抛出 `Error`。
   */
  private parseBytes(): Buffer {
    const separator = this.bytes.indexOf(0x3a, this.offset);
    if (separator === -1) throw new Error('torrent-descriptor-string-invalid');
    const lengthText = this.bytes
      .subarray(this.offset, separator)
      .toString('ascii');
    if (!/^(0|[1-9]\d*)$/.test(lengthText)) {
      throw new Error('torrent-descriptor-string-invalid');
    }
    const length = Number(lengthText);
    const start = separator + 1;
    const end = start + length;
    if (!Number.isSafeInteger(length) || end > this.bytes.length) {
      throw new Error('torrent-descriptor-string-invalid');
    }
    this.offset = end;
    return this.bytes.subarray(start, end);
  }
}

/**
 * 要求 Bencode 值为字典，否则抛出调用方指定错误码。
 * @param value - 参与Dictionary比较、格式化或输出的候选值。
 * @param code - 决定Dictionary内容、边界或目标的 `code` 值。
 * @returns 已确认是 Bencode 字典的键值映射；类型不符时函数抛出异常而不返回。
 * @throws 当 `!(value instanceof Map)` 成立时拒绝当前输入并抛出 `Error`。
 */
function requireDictionary(
  value: BencodeValue | undefined,
  code: string,
): Map<string, BencodeValue> {
  if (!(value instanceof Map)) throw new Error(code);
  return value;
}

/**
 * 要求 Bencode 值为字节串，否则抛出调用方指定错误码。
 * @param value - 参与Bytes比较、格式化或输出的候选值。
 * @param code - 决定Bytes内容、边界或目标的 `code` 值。
 * @returns 已确认是 Bencode 字节串的 Buffer；类型不符时函数抛出异常而不返回。
 * @throws 当 `!Buffer.isBuffer(value)` 成立时拒绝当前输入并抛出 `Error`。
 */
function requireBytes(value: BencodeValue | undefined, code: string): Buffer {
  if (!Buffer.isBuffer(value)) throw new Error(code);
  return value;
}

/**
 * 按输入约束要求文件长度为非负数值。
 * @param value - 参与按输入约束要求文件长度为非负数值比较、格式化或输出的候选值。
 * @returns 按输入约束要求文件长度为非负数值。
 * @throws 当 `typeof value !== 'number' || value < 0` 成立时拒绝当前输入并抛出 `Error`。
 */
function requireSize(value: BencodeValue | undefined): number {
  if (typeof value !== 'number' || value < 0) {
    throw new Error('torrent-descriptor-file-size-invalid');
  }
  return value;
}

/**
 * 将非空路径片段拼为长度受限的相对路径。
 * @param segments - 决定将非空路径片段拼为长度受限的相对路径内容、边界或目标的 `segments` 值。
 * @returns 将非空路径片段拼为长度受限的相对路径。
 * @throws 当 `parts.some((part) => !part) || parts.join('/').length > 1000` 成立时拒绝当前输入并抛出 `Error`。
 */
function pathFromSegments(segments: BencodeValue[]): string {
  const parts = segments.map((segment) =>
    requireBytes(segment, 'torrent-descriptor-path-invalid').toString('utf8'),
  );
  if (parts.some((part) => !part) || parts.join('/').length > 1000) {
    throw new Error('torrent-descriptor-path-invalid');
  }
  return parts.join('/');
}

/**
 * 从种子 info 字典生成去重且过滤填充文件的安全清单。
 * @param info - 用于从种子 info 字典生成去重且过滤填充文件的安全清单的领域对象，包含 `get` 字段。
 * @returns 按输入顺序得到的从种子 info 字典生成去重且过滤填充文件的安全清单列表；没有匹配项时为空数组。
 * @throws 当 `Array.isArray(files) === (typeof length === 'number')` 成立时拒绝当前输入并抛出 `Error`；当 `rawEntries.length === 0 || rawEntries.length > MAX_FILES` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `manifest.length === 0` 成立时拒绝当前输入并抛出 `Error`。
 */
function parseManifest(info: Map<string, BencodeValue>): ManifestEntry[] {
  const name = requireBytes(
    info.get('name.utf-8') ?? info.get('name'),
    'torrent-descriptor-name-invalid',
  ).toString('utf8');
  const files = info.get('files');
  const length = info.get('length');
  if (Array.isArray(files) === (typeof length === 'number')) {
    throw new Error('torrent-descriptor-files-invalid');
  }

  let rawEntries: Array<{ attr: string; path: string; sizeBytes: number }>;
  if (Array.isArray(files)) {
    rawEntries = files.map((item) => {
      const file = requireDictionary(item, 'torrent-descriptor-file-invalid');
      const filePath = file.get('path.utf-8') ?? file.get('path');
      if (!Array.isArray(filePath)) {
        throw new Error('torrent-descriptor-path-invalid');
      }
      const attr = file.get('attr');
      let attrText = '';
      if (Buffer.isBuffer(attr)) attrText = attr.toString('ascii');
      return {
        attr: attrText,
        path: pathFromSegments(filePath),
        sizeBytes: requireSize(file.get('length')),
      };
    });
  } else {
    rawEntries = [{ attr: '', path: name, sizeBytes: requireSize(length) }];
  }

  if (rawEntries.length === 0 || rawEntries.length > MAX_FILES) {
    throw new Error('torrent-descriptor-file-count-invalid');
  }
  const paths = new Set<string>();
  let visibleIndex = 0;
  const manifest = rawEntries.flatMap((entry) => {
    let entryType: 'file' | 'symbolic-link' = 'file';
    if (entry.attr.includes('l')) entryType = 'symbolic-link';
    const relativePath = validateDescriptorManifestEntry({
      entryType,
      executable: entry.attr.includes('x'),
      relativePath: entry.path,
    });
    if (paths.has(relativePath)) {
      throw new Error('torrent-descriptor-path-duplicated');
    }
    paths.add(relativePath);
    if (entry.attr.includes('p')) return [];
    return [
      {
        executable: false,
        index: visibleIndex++,
        relativePath,
        sizeBytes: entry.sizeBytes,
      },
    ];
  });
  if (manifest.length === 0) {
    throw new Error('torrent-descriptor-file-count-invalid');
  }
  return manifest;
}

/**
 * 仅接受单文件 Assrt HTTPS 字幕 web-seed 与私有内联正文，并把 torrent piece 摘要保留给执行器复核载荷。
 * @param root - 已解析的 torrent 根字典。
 * @param info - 参与 info-hash 的 torrent 字典。
 * @param manifest - 已通过路径和文件类型校验的清单。
 * @returns 唯一安全 web-seed 的地址、内联载荷、分片长度和逐片 SHA-1；没有 web-seed 时返回 `null`。
 * @throws 当 web-seed 不是唯一 Assrt HTTPS 单字幕文件，或内联载荷与 piece 合同不一致时抛出。
 */
function parseDirectSubtitleWebSeed(
  root: Map<string, BencodeValue>,
  info: Map<string, BencodeValue>,
  manifest: ManifestEntry[],
) {
  const raw = root.get('url-list');
  const rawPayload = root.get('kt-direct-payload');
  if (raw === undefined) {
    if (rawPayload !== undefined) {
      throw new Error('torrent-descriptor-direct-payload-invalid');
    }
    return null;
  }
  let values: BencodeValue[] = [];
  if (Buffer.isBuffer(raw)) {
    values = [raw];
  } else if (Array.isArray(raw)) {
    values = raw;
  } else {
    throw new Error('torrent-descriptor-web-seed-invalid');
  }
  if (values.length !== 1 || manifest.length !== 1) {
    throw new Error('torrent-descriptor-web-seed-invalid');
  }
  const webSeedText = requireBytes(
    values[0],
    'torrent-descriptor-web-seed-invalid',
  ).toString('utf8');
  let webSeed: URL;
  try {
    webSeed = new URL(webSeedText);
  } catch {
    throw new Error('torrent-descriptor-web-seed-invalid');
  }
  const entry = manifest[0]!;
  if (webSeed.protocol !== 'https:' || webSeed.hostname !== '2.assrt.net') {
    throw new Error('torrent-descriptor-web-seed-invalid');
  }
  if (webSeed.port || webSeed.username || webSeed.password) {
    throw new Error('torrent-descriptor-web-seed-invalid');
  }
  if (webSeed.search || webSeed.hash) {
    throw new Error('torrent-descriptor-web-seed-invalid');
  }
  if (
    !ASSRT_WEB_SEED_PATH.test(webSeed.pathname) ||
    !DIRECT_SUBTITLE_SUFFIX.test(entry.relativePath)
  ) {
    throw new Error('torrent-descriptor-web-seed-invalid');
  }
  const pieceLength = info.get('piece length');
  const pieces = requireBytes(
    info.get('pieces'),
    'torrent-descriptor-piece-contract-invalid',
  );
  const expectedPieceCount = Math.ceil(entry.sizeBytes / Number(pieceLength));
  if (!Number.isSafeInteger(pieceLength)) {
    throw new Error('torrent-descriptor-piece-contract-invalid');
  }
  if (
    Number(pieceLength) < 16 * 1024 ||
    Number(pieceLength) > 16 * 1024 * 1024
  ) {
    throw new Error('torrent-descriptor-piece-contract-invalid');
  }
  if (
    pieces.length % 20 !== 0 ||
    pieces.length / 20 !== expectedPieceCount
  ) {
    throw new Error('torrent-descriptor-piece-contract-invalid');
  }
  const pieceSha1: string[] = [];
  for (let offset = 0; offset < pieces.length; offset += 20) {
    pieceSha1.push(pieces.subarray(offset, offset + 20).toString('hex'));
  }
  const payload = requireBytes(
    rawPayload,
    'torrent-descriptor-direct-payload-invalid',
  );
  if (payload.length !== entry.sizeBytes) {
    throw new Error('torrent-descriptor-direct-payload-invalid');
  }
  const payloadPieces: string[] = [];
  const normalizedPieceLength = Number(pieceLength);
  for (let offset = 0; offset < payload.length; offset += normalizedPieceLength) {
    payloadPieces.push(
      createHash('sha1')
        .update(payload.subarray(offset, offset + normalizedPieceLength))
        .digest('hex'),
    );
  }
  if (
    payloadPieces.length !== pieceSha1.length ||
    payloadPieces.some((digest, index) => digest !== pieceSha1[index])
  ) {
    throw new Error('torrent-descriptor-direct-payload-invalid');
  }
  return {
    payload: Buffer.from(payload),
    pieceLength: normalizedPieceLength,
    pieceSha1,
    urls: [webSeed.toString()],
  };
}

/**
 * 解析并校验种子描述符，返回 info hash、文件清单及稳定摘要。
 * @param bytes - 用于并校验种子描述符，返回 info hash、文件清单及稳定摘要的领域对象，包含 `length`、`subarray` 字段。
 * @returns 包含 `descriptorSha256`、`infoHash`、`manifest`、`manifestSha256` 字段的并校验种子描述符，返回 info hash、文件清单及稳定摘要。
 * @throws 当 `bytes.length === 0 || bytes.length > MAX_DESCRIPTOR_BYTES` 成立时拒绝当前输入并抛出 `Error`；当 `!parser.infoRange` 成立时拒绝当前输入并抛出 `Error`。
 */
export function parseTorrentDescriptor(bytes: Buffer) {
  if (bytes.length === 0 || bytes.length > MAX_DESCRIPTOR_BYTES) {
    throw new Error('torrent-descriptor-size-invalid');
  }
  const parser = new BencodeParser(bytes);
  const root = parser.parseRoot();
  const info = requireDictionary(
    root.get('info'),
    'torrent-descriptor-info-invalid',
  );
  if (!parser.infoRange) throw new Error('torrent-descriptor-info-invalid');
  const manifest = parseManifest(info);
  const infoBytes = bytes.subarray(
    parser.infoRange.start,
    parser.infoRange.end,
  );
  return {
    descriptorSha256: createHash('sha256').update(bytes).digest('hex'),
    directSubtitleWebSeed: parseDirectSubtitleWebSeed(root, info, manifest),
    infoHash: createHash('sha1').update(infoBytes).digest('hex'),
    manifest,
    manifestSha256: createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex'),
  };
}
