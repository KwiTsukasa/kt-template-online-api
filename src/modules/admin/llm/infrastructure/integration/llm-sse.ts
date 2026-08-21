import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';

const DEFAULT_MAX_STREAM_BYTES = 8 * 1024 * 1024;

export interface ParsedSseEvent {
  data: string;
  event: string;
}

/**
 * 按网络到达顺序解析 SSE 帧，正确处理 UTF-8 分片、CRLF、注释和多行 data。
 * @param stream - 上游 Node 可读流。
 * @param signal - 调用方取消时立即中止解析的信号。
 * @param maximumBytes - 本次响应允许读取的最大字节数；省略时使用 8 MiB。
 * @returns 逐个产出事件名与合并 data 文本的异步流。
 * @throws 响应超限或调用方取消时抛出错误。
 */
export async function* parseSseStream(
  stream: Readable,
  signal: AbortSignal,
  maximumBytes = DEFAULT_MAX_STREAM_BYTES,
): AsyncGenerator<ParsedSseEvent> {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let receivedBytes = 0;
  for await (const rawChunk of stream) {
    if (signal.aborted) throw new Error('llm-stream-aborted');
    let chunk: Buffer;
    if (Buffer.isBuffer(rawChunk)) {
      chunk = rawChunk;
    } else {
      chunk = Buffer.from(rawChunk);
    }
    receivedBytes += chunk.byteLength;
    if (receivedBytes > maximumBytes) {
      throw new Error('llm-stream-response-too-large');
    }
    buffer += decoder.write(chunk);
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseFrame(frame);
      if (parsed) yield parsed;
      boundary = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.end();
  const parsed = parseSseFrame(buffer.replace(/\r\n/g, '\n'));
  if (parsed) yield parsed;
}

/**
 * 把单个 SSE 帧投影为事件名和 data，忽略注释及未知协议字段。
 * @param frame - 不含帧终止空行的 SSE 文本。
 * @returns 含 data 时返回解析结果，否则返回 null。
 */
function parseSseFrame(frame: string): ParsedSseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { data: dataLines.join('\n'), event };
}
