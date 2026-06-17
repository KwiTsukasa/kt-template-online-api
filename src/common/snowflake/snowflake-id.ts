import type { SnowflakeEntity } from '../types';

const TWEPOCH = 1288834974657n;
const WORKER_ID_BITS = 5n;
const DATACENTER_ID_BITS = 5n;
const SEQUENCE_BITS = 12n;

const MAX_WORKER_ID = (1n << WORKER_ID_BITS) - 1n;
const MAX_DATACENTER_ID = (1n << DATACENTER_ID_BITS) - 1n;
const SEQUENCE_MASK = (1n << SEQUENCE_BITS) - 1n;
const WORKER_ID_SHIFT = SEQUENCE_BITS;
const DATACENTER_ID_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS;
const TIMESTAMP_LEFT_SHIFT =
  SEQUENCE_BITS + WORKER_ID_BITS + DATACENTER_ID_BITS;

class SnowflakeIdGenerator {
  private readonly workerId = this.readNodeId(
    'SNOWFLAKE_WORKER_ID',
    MAX_WORKER_ID,
  );
  private readonly datacenterId = this.readNodeId(
    'SNOWFLAKE_DATACENTER_ID',
    MAX_DATACENTER_ID,
  );
  private lastTimestamp = -1n;
  private sequence = 0n;

  /**
   * 执行 当前模块流程。
   */
  nextId() {
    let timestamp = this.currentTime();

    if (timestamp < this.lastTimestamp) {
      timestamp = this.waitUntil(this.lastTimestamp);
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & SEQUENCE_MASK;
      if (this.sequence === 0n) {
        timestamp = this.waitUntil(this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    return (
      ((timestamp - TWEPOCH) << TIMESTAMP_LEFT_SHIFT) |
      (this.datacenterId << DATACENTER_ID_SHIFT) |
      (this.workerId << WORKER_ID_SHIFT) |
      this.sequence
    ).toString();
  }

  /**
   * 执行 当前模块流程。
   */
  private currentTime() {
    return BigInt(Date.now());
  }

  /**
   * 执行 当前模块流程。
   * @param lastTimestamp - lastTimestamp 输入；影响 waitUntil 的返回值。
   */
  private waitUntil(lastTimestamp: bigint) {
    // Snowflake requires monotonic timestamps; waiting avoids duplicate IDs
    // when the system clock briefly moves backwards or a millisecond is full.
    let timestamp = this.currentTime();
    while (timestamp <= lastTimestamp) {
      timestamp = this.currentTime();
    }
    return timestamp;
  }

  /**
   * 读取 当前模块资源。
   * @param envName - envName 输入；驱动 `Number()` 的 公共基础设施步骤。
   * @param max - max 输入；影响 readNodeId 的返回值。
   */
  private readNodeId(envName: string, max: bigint) {
    const value = Number(process.env[envName] || 1);
    if (!Number.isInteger(value) || value < 0 || value > Number(max)) {
      return 1n;
    }
    return BigInt(value);
  }
}

const snowflakeIdGenerator = new SnowflakeIdGenerator();

/**
 * 创建 当前模块对象或配置。
 */
export const createSnowflakeId = () => snowflakeIdGenerator.nextId();

/**
 * 判断 当前模块条件。
 * @param id - 公共基础设施记录 ID；定位本次读取、更新、删除或关联的公共基础设施记录。
 */
export const isEmptySnowflakeId = (id: SnowflakeEntity['id']) =>
  id === undefined || id === null || id === '' || id === 0 || id === '0';

/**
 * 确保Snowflake Id。
 * @param entity - entity 输入；使用 `id` 字段生成结果。
 */
export const ensureSnowflakeId = <T extends SnowflakeEntity>(entity: T) => {
  if (isEmptySnowflakeId(entity.id)) {
    entity.id = createSnowflakeId();
  } else {
    entity.id = String(entity.id);
  }
  return entity.id;
};
