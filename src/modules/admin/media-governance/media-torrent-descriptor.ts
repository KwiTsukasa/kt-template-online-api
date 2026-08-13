import { createHash } from 'node:crypto';
import { validateDescriptorManifestEntry } from './media-governance-domain';

const MAX_DESCRIPTOR_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_NESTING_DEPTH = 64;

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

  parseRoot(): Map<string, BencodeValue> {
    const root = this.parseValue(true, 0);
    if (!(root instanceof Map) || this.offset !== this.bytes.length) {
      throw new Error('torrent-descriptor-root-invalid');
    }
    return root;
  }

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

function requireDictionary(
  value: BencodeValue | undefined,
  code: string,
): Map<string, BencodeValue> {
  if (!(value instanceof Map)) throw new Error(code);
  return value;
}

function requireBytes(value: BencodeValue | undefined, code: string): Buffer {
  if (!Buffer.isBuffer(value)) throw new Error(code);
  return value;
}

function requireSize(value: BencodeValue | undefined): number {
  if (typeof value !== 'number' || value < 0) {
    throw new Error('torrent-descriptor-file-size-invalid');
  }
  return value;
}

function pathFromSegments(segments: BencodeValue[]): string {
  const parts = segments.map((segment) =>
    requireBytes(segment, 'torrent-descriptor-path-invalid').toString('utf8'),
  );
  if (parts.some((part) => !part) || parts.join('/').length > 1000) {
    throw new Error('torrent-descriptor-path-invalid');
  }
  return parts.join('/');
}

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

  const rawEntries = Array.isArray(files)
    ? files.map((item) => {
        const file = requireDictionary(item, 'torrent-descriptor-file-invalid');
        const path = file.get('path.utf-8') ?? file.get('path');
        if (!Array.isArray(path)) {
          throw new Error('torrent-descriptor-path-invalid');
        }
        const attr = file.get('attr');
        return {
          attr: Buffer.isBuffer(attr) ? attr.toString('ascii') : '',
          path: pathFromSegments(path),
          sizeBytes: requireSize(file.get('length')),
        };
      })
    : [{ attr: '', path: name, sizeBytes: requireSize(length) }];

  if (rawEntries.length === 0 || rawEntries.length > MAX_FILES) {
    throw new Error('torrent-descriptor-file-count-invalid');
  }
  const paths = new Set<string>();
  const manifest = rawEntries.flatMap((entry, index) => {
    const relativePath = validateDescriptorManifestEntry({
      entryType: entry.attr.includes('l') ? 'symbolic-link' : 'file',
      executable: entry.attr.includes('x'),
      relativePath: entry.path,
    });
    if (paths.has(relativePath)) {
      throw new Error('torrent-descriptor-path-duplicated');
    }
    paths.add(relativePath);
    if (entry.attr.includes('p')) return [];
    return [{
      executable: false,
      index,
      relativePath,
      sizeBytes: entry.sizeBytes,
    }];
  });
  if (manifest.length === 0) {
    throw new Error('torrent-descriptor-file-count-invalid');
  }
  return manifest;
}

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
    infoHash: createHash('sha1').update(infoBytes).digest('hex'),
    manifest,
    manifestSha256: createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex'),
  };
}
