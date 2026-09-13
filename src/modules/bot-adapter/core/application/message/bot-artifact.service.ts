import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MinioService } from 'nestjs-minio-client';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { BotMessage } from '../../infrastructure/persistence/message/bot-message.entity';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import { toBotPluginMessageEvent } from '../event/plugin-event.mapper';

const BUCKET = 'kt-bot-artifacts-private';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
type ImageRecord = {
  index: number;
  key: string;
  sha256: string;
  mimeType: string;
  size: number;
};

@Injectable()
export class BotArtifactService {
  private bucketReady?: Promise<void>;
  constructor(
    private readonly minio: MinioService,
    @InjectRepository(BotMessage)
    private readonly messages: Repository<BotMessage>,
  ) {}

  /**
   * 限制对象存储请求的等待时间，迟到的流立即关闭，写入仍使用相同内容哈希保持幂等。
   * @param operation - 本次私有对象存储操作。
   * @param disposeLate - 超时后才返回资源时使用的释放函数。
   * @returns 在二十秒内返回的存储结果。
   * @throws 存储请求超时或原操作失败时交由任务保留状态并恢复。
   */
  private async storage<T>(
    operation: () => Promise<T>,
    disposeLate?: (value: T) => void,
  ): Promise<T> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = operation().then((value) => {
      if (expired) disposeLate?.(value);
      return value;
    });
    try {
      return await Promise.race([
        result,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(new Error('Bot私有资源存储请求超时'));
          }, 20000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 以真实账号、会话和消息身份生成私有对象前缀，不接受模型提供存储路径。
   * @param message - 宿主确认的当前消息。
   * @param messageId - 同一会话内的原始消息标识。
   * @returns 不能跨会话复用的对象前缀。
   */
  private prefix(message: BotNormalizedMessage, messageId: string): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          message.selfId,
          message.messageType,
          message.targetId,
          messageId,
        ]),
      )
      .digest('hex');
  }

  /**
   * 建立专用私有桶并验证没有公开策略，失败后允许下一次重新连接。
   * @throws 存储桶被配置公开访问或存储服务不可达时拒绝写入。
   */
  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const client = this.minio.client;
        if (!(await this.storage(() => client.bucketExists(BUCKET)))) {
          try {
            await this.storage(() => client.makeBucket(BUCKET));
          } catch (error) {
            if (!(await this.storage(() => client.bucketExists(BUCKET))))
              throw error;
          }
        }
        let policy = '';
        try {
          policy = await this.storage(() => client.getBucketPolicy(BUCKET));
        } catch (error) {
          if ((error as { code?: string }).code !== 'NoSuchBucketPolicy')
            throw error;
        }
        if (policy && JSON.parse(policy).Statement?.length)
          throw new Error('Bot私有资源桶不允许配置公开策略');
      })().catch((error) => {
        this.bucketReady = undefined;
        throw error;
      });
    }
    await this.bucketReady;
  }

  /**
   * 将 QQ 附件的字节、签名和来源消息保存到私有桶；重复接收时直接返回已存在的清单。
   * @param message - 带真实平台附件的已授权消息。
   * @returns 可供后续对话回读的图片清单，不包含存储地址或平台临时链接。
   * @throws 附件来源、数量、格式、体积或存储校验失败时拒绝保存。
   */
  async capture(message: BotNormalizedMessage) {
    const urls = toBotPluginMessageEvent(message).imageUrls || [];
    if (!urls.length) return [];
    if (urls.length > 8) throw new Error('一次最多保存8张图片');
    await this.ensureBucket();
    const prefix = this.prefix(message, message.messageId);
    try {
      const existing = JSON.parse(
        (await this.readBytes(`${prefix}/images.json`, 16000)).toString(),
      );
      return existing.images as ImageRecord[];
    } catch (error) {
      if (
        !['NoSuchKey', 'NotFound'].includes(
          String((error as { code?: string }).code),
        )
      )
        throw error;
    }
    const images: ImageRecord[] = [];
    let remaining = 6 * 1024 * 1024;
    for (const [index, source] of urls.entries()) {
      const url = new URL(source);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !/(?:^|\.)(?:qpic\.cn|qq\.com|qq\.com\.cn)$/iu.test(url.hostname)
      )
        throw new Error('图片必须来自QQ平台附件域名');
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok || !response.body) throw new Error('QQ附件暂时无法下载');
      const limit = Math.min(MAX_IMAGE_BYTES, remaining);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw new Error('图片超过单张4MiB或总计6MiB上限');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      const mimeType = imageMime(bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const key = `${prefix}/${index}-${sha256}`;
      await this.storage(() =>
        this.minio.client.putObject(BUCKET, key, bytes, bytes.length, {
          'Content-Type': mimeType,
        }),
      );
      images.push({ index, key, sha256, mimeType, size: bytes.length });
      remaining -= bytes.length;
    }
    const manifest = Buffer.from(
      JSON.stringify({ version: 1, messageId: message.messageId, images }),
    );
    await this.storage(() =>
      this.minio.client.putObject(
        BUCKET,
        `${prefix}/images.json`,
        manifest,
        manifest.length,
        { 'Content-Type': 'application/json' },
      ),
    );
    return images;
  }

  /**
   * 按当前聊天的消息标识回读一张已保存图片，验证时间、完整性和会话归属。
   * @param message - 当前已授权的工具调用消息。
   * @param input - 同群原始消息标识及从零开始的图片序号。
   * @returns 真实图片字节与来源，供MCP转换为模型能读取的图片内容。
   * @throws 消息不属于当前会话、图片未保存或校验失败时拒绝读取。
   */
  async readImage(
    message: BotNormalizedMessage,
    input: Record<string, unknown>,
  ) {
    const messageId = String(input.messageId || '');
    const index = Number(input.index || 0);
    if (
      !messageId ||
      messageId.length > 255 ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 7
    )
      throw new Error('图片消息标识或序号无效');
    const original = await this.messages.findOne({
      where: {
        selfId: message.selfId,
        messageType: message.messageType,
        targetId: message.targetId,
        messageId,
        direction: 'inbound',
      },
    });
    if (!original || original.eventTime.getTime() > message.eventTime.getTime())
      throw new Error('图片消息不在当前会话历史中');
    await this.ensureBucket();
    const prefix = this.prefix(message, messageId);
    const manifest = JSON.parse(
      (await this.readBytes(`${prefix}/images.json`, 16000)).toString(),
    );
    const record = manifest.images?.[index] as ImageRecord | undefined;
    if (!record || !record.key.startsWith(`${prefix}/`))
      throw new Error('这张历史图片未保存');
    const bytes = await this.readBytes(record.key, MAX_IMAGE_BYTES);
    if (
      createHash('sha256').update(bytes).digest('hex') !== record.sha256 ||
      imageMime(bytes) !== record.mimeType
    )
      throw new Error('历史图片完整性校验失败');
    return {
      messageId,
      index,
      sender: original.senderNickname,
      timestamp: original.eventTime.toISOString(),
      sha256: record.sha256,
      mimeType: record.mimeType,
      data: bytes.toString('base64'),
    };
  }

  /**
   * 保存完成后的回复内容，队列只保留私有对象引用，避免长图挤占 Redis 内存。
   * @param taskId - 宿主生成的任务哈希。
   * @param value - 由插件协议校验过的回复结果。
   * @returns 用于回读时验证内容的 SHA256。
   * @throws 任务标识或结果体积无效时拒绝保存。
   */
  async saveResult(taskId: string, value: unknown): Promise<string> {
    if (!/^[a-f0-9]{64}$/u.test(taskId)) throw new Error('任务标识无效');
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > 48 * 1024 * 1024)
      throw new Error('任务结果超过保存上限');
    await this.ensureBucket();
    const hash = createHash('sha256').update(bytes).digest('hex');
    await this.storage(() =>
      this.minio.client.putObject(
        BUCKET,
        `tasks/${taskId}/${hash}`,
        bytes,
        bytes.length,
        { 'Content-Type': 'application/json' },
      ),
    );
    return hash;
  }

  /**
   * 从私有对象取回完整回复，投递失败后不用再次调用模型或业务工具。
   * @param taskId - 原始任务哈希。
   * @param hash - 入队状态保存的结果哈希。
   * @returns 校验后的原始回复结果。
   * @throws 对象标识或内容完整性不符时拒绝返回。
   */
  async readResult(taskId: string, hash: string): Promise<any> {
    if (!/^[a-f0-9]{64}$/u.test(taskId) || !/^[a-f0-9]{64}$/u.test(hash))
      throw new Error('任务结果标识无效');
    await this.ensureBucket();
    const bytes = await this.readBytes(
      `tasks/${taskId}/${hash}`,
      48 * 1024 * 1024,
    );
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error('任务结果完整性校验失败');
    return JSON.parse(bytes.toString());
  }

  /**
   * 在对象元数据与流读取两个阶段限制私有资源体积。
   * @param key - 由本服务生成的对象键。
   * @param maximum - 允许读取的最大字节数。
   * @returns 完整且未超过预算的对象字节。
   * @throws 对象不存在或超出体积限制时拒绝返回内容。
   */
  private async readBytes(key: string, maximum: number): Promise<Buffer> {
    const stat = await this.storage(() =>
      this.minio.client.statObject(BUCKET, key),
    );
    if (stat.size > maximum) throw new Error('Bot资源超过读取上限');
    const stream = await this.storage(
      () => this.minio.client.getObject(BUCKET, key),
      (late) => late.destroy(),
    );
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      return await this.storage(async () => {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maximum) throw new Error('Bot资源超过读取上限');
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      });
    } finally {
      stream.destroy();
    }
  }
}

/**
 * 根据图片文件签名选择真实类型，不信任远程响应头或文件扩展名。
 * @param bytes - 已完成体积检查的附件字节。
 * @returns 模型能够读取的图片类型。
 * @throws 文件不是受支持图片时拒绝持久化或读取。
 */
function imageMime(bytes: Buffer): string {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (/^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image/webp';
  throw new Error('不支持的图片文件格式');
}
