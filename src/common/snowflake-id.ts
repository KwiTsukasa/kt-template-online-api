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

  private currentTime() {
    return BigInt(Date.now());
  }

  private waitUntil(lastTimestamp: bigint) {
    // Snowflake requires monotonic timestamps; waiting avoids duplicate IDs
    // when the system clock briefly moves backwards or a millisecond is full.
    let timestamp = this.currentTime();
    while (timestamp <= lastTimestamp) {
      timestamp = this.currentTime();
    }
    return timestamp;
  }

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

export type SnowflakeEntity = {
  id?: number | string | null;
};

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
