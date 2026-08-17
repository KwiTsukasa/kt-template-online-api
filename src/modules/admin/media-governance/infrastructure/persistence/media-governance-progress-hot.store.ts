import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { MediaGovernanceExecutorEventDto } from '@/modules/admin/media-governance/contract/media-governance.dto';

export const MEDIA_GOVERNANCE_PROGRESS_HOT_STORE = Symbol(
  'MEDIA_GOVERNANCE_PROGRESS_HOT_STORE',
);

export interface MediaGovernanceProgressHotAppendResult {
  applied: boolean;
  authorityRequired: boolean;
  previousSequence: number;
  sequenceGap: boolean;
  snapshotRequired: boolean;
}

export interface MediaGovernanceProgressHotStore {
  append(
    event: MediaGovernanceExecutorEventDto,
    authoritySequence: null | number,
  ): Promise<MediaGovernanceProgressHotAppendResult>;
}

const APPEND_PROGRESS_SCRIPT = `
local persisted = redis.call('GET', KEYS[1])
local authority = tonumber(ARGV[2])
if not persisted and authority < 0 then
  return {0, 0, 0, 0, 1}
end
local current = tonumber(persisted or ARGV[2])
local incoming = tonumber(ARGV[1])
if incoming <= current then
  return {0, current, 0, 0, 0}
end
if incoming ~= current + 1 then
  return {0, current, 1, 0, 0}
end

redis.call('SET', KEYS[1], incoming, 'EX', ARGV[5])
redis.call(
  'XADD',
  KEYS[2],
  'MAXLEN',
  '~',
  ARGV[6],
  '*',
  'sequence',
  ARGV[1],
  'payload',
  ARGV[3]
)
redis.call('EXPIRE', KEYS[2], ARGV[5])

local now = tonumber(ARGV[4])
local lastSnapshotAt = tonumber(redis.call('HGET', KEYS[3], 'at') or '0')
local lastFingerprint = redis.call('HGET', KEYS[3], 'fingerprint') or ''
local snapshotRequired = 0
if now - lastSnapshotAt >= 10000 or ARGV[7] ~= lastFingerprint then
  snapshotRequired = 1
  redis.call('HSET', KEYS[3], 'at', now, 'fingerprint', ARGV[7])
  redis.call('EXPIRE', KEYS[3], ARGV[5])
end

return {1, current, 0, snapshotRequired, 0}
`;

const HOT_RETENTION_SECONDS = 24 * 60 * 60;
const HOT_STREAM_MAX_LENGTH = 10_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;

@Injectable()
export class MediaGovernanceRedisProgressHotStore implements MediaGovernanceProgressHotStore {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  /** 原子追加运行进度，校验顺序并返回是否需要权威序号或持久快照。 */
  async append(
    event: MediaGovernanceExecutorEventDto,
    authoritySequence: null | number,
  ): Promise<MediaGovernanceProgressHotAppendResult> {
    if (
      !SAFE_ID.test(event.runId) ||
      (authoritySequence !== null &&
        (!Number.isSafeInteger(authoritySequence) || authoritySequence < 0))
    ) {
      throw new Error('media-governance-progress-hot-identity-invalid');
    }
    const prefix = `kt:media-governance:run:${event.runId}`;
    let progress = null;
    if (event.progress) progress = { ...event.progress };
    const result = (await this.redis.eval(
      APPEND_PROGRESS_SCRIPT,
      3,
      `${prefix}:sequence`,
      `${prefix}:events`,
      `${prefix}:snapshot`,
      String(event.sequence),
      String(authoritySequence ?? -1),
      JSON.stringify({
        eventType: event.eventType,
        observedAt: event.observedAt,
        progress,
        runId: event.runId,
        sequence: event.sequence,
        sourceId: event.sourceId ?? null,
        summary: event.summary,
        taskId: event.taskId,
      }),
      String(Date.parse(event.observedAt)),
      String(HOT_RETENTION_SECONDS),
      String(HOT_STREAM_MAX_LENGTH),
      this.snapshotFingerprint(event),
    )) as number[];
    if (
      !Array.isArray(result) ||
      result.length !== 5 ||
      result.some((value) => !Number.isFinite(Number(value)))
    ) {
      throw new Error('media-governance-progress-hot-result-invalid');
    }
    return {
      applied: Number(result[0]) === 1,
      authorityRequired: Number(result[4]) === 1,
      previousSequence: Number(result[1]),
      sequenceGap: Number(result[2]) === 1,
      snapshotRequired: Number(result[3]) === 1,
    };
  }

  /** 将进度事件压缩为用于控制持久快照频率的稳定指纹。 */
  private snapshotFingerprint(event: MediaGovernanceExecutorEventDto) {
    if (!event.progress) return event.eventType;
    let percent = 0;
    if (event.progress.totalBytes !== 0) {
      percent = Math.floor(
        (event.progress.completedBytes / event.progress.totalBytes) * 100,
      );
    }
    return [event.eventType, event.progress.completedItems, percent].join(':');
  }
}
