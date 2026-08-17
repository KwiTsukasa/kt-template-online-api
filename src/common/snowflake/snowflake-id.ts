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
   * 根据毫秒时间戳、数据中心、工作节点和同毫秒序列生成十进制 Snowflake ID；时钟回拨或序列溢出时等待下一可用毫秒。
   * @returns 下次运行时间标识。
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
   * 读取当前 Unix 毫秒时间，并转换为 Snowflake 计算使用的 `bigint`。
   * @returns 时间。
   */
  private currentTime() {
    return BigInt(Date.now());
  }

  /**
   * 根据`lastTimestamp`处理下一毫秒时间戳。
   * @param lastTimestamp - 决定下一毫秒时间戳内容、边界或目标的 `lastTimestamp` 值。
   * @returns 下一毫秒时间戳。
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
   * 从指定环境变量读取 Snowflake 节点编号；非法或超出给定上限时回退为 `1n`。
   * @param envName - 决定从指定环境变量读取 Snowflake 节点编号内容、边界或目标的 `envName` 值。
   * @param max - 决定从指定环境变量读取 Snowflake 节点编号内容、边界或目标的 `max` 值。
   * @returns 从指定环境变量读取 Snowflake 节点编号。
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

export const createSnowflakeId = () => snowflakeIdGenerator.nextId();

export const isEmptySnowflakeId = (id: SnowflakeEntity['id']) =>
  id === undefined || id === null || id === '' || id === 0 || id === '0';

export const ensureSnowflakeId = <T extends SnowflakeEntity>(entity: T) => {
  if (isEmptySnowflakeId(entity.id)) {
    entity.id = createSnowflakeId();
  } else {
    entity.id = String(entity.id);
  }
  return entity.id;
};
