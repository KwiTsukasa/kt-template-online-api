import type { DataSource, EntityManager } from 'typeorm';
import type { PoolConnection } from 'mysql2';
import type { Connection, RowDataPacket } from 'mysql2/promise';

import type { LockLease, LockResult } from './lock.types';

interface LockSession {
  query: (
    sql: string,
    parameters: unknown[],
  ) => Promise<Array<Record<string, unknown>>>;
  discard: () => void;
}

const discardedConnections = new WeakSet<Connection>();
const LOCK_NETWORK_GRACE_MS = 2000;
const MAX_WAIT_SECONDS = Math.floor(
  (2_147_483_647 - LOCK_NETWORK_GRACE_MS) / 1000,
);

/**
 * 拒绝非法锁键或无限等待，在创建数据库连接前发现错误的资源声明。
 * @param name - 业务模块声明的稳定会话锁键。
 * @param waitSeconds - 等待秒数，零表示立即返回繁忙。
 * @throws 锁键为空、超过数据库限制或等待不是非负安全整数时拒绝执行。
 */
function validateLockRequest(name: string, waitSeconds: number): void {
  if (typeof name !== 'string' || !name.length || name.length > 64)
    throw new Error('数据库锁键需要1至64个字符');
  if (
    !Number.isSafeInteger(waitSeconds) ||
    waitSeconds < 0 ||
    waitSeconds > MAX_WAIT_SECONDS
  )
    throw new Error('数据库锁等待时间超出允许范围');
}

/**
 * 为锁查询增加独立响应期限，服务端竞争等待之外只允许有限网络宽限，超时由持有者丢弃会话。
 * @param session - 锁所绑定的独占物理会话。
 * @param sql - 全局锁实现拥有的查询语句。
 * @param parameters - 当前资源键与可选等待参数。
 * @param waitSeconds - 仅获取锁时包含服务端等待秒数，其他查询默认为零。
 * @returns 在期限内收到的原始锁回执。
 * @throws 数据库响应超过期限时拒绝继续业务操作。
 */
async function lockQuery(
  session: LockSession,
  sql: string,
  parameters: unknown[],
  waitSeconds = 0,
): Promise<Array<Record<string, unknown>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('数据库锁查询超时')),
      waitSeconds * 1000 + LOCK_NETWORK_GRACE_MS,
    );
  });
  try {
    return await Promise.race([session.query(sql, parameters), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 统一解析互斥锁的二值回执，数据库未知结果不能伪装成正常竞争失败。
 * @param value - 数据库返回的获取、所有权或释放结果。
 * @returns 数据库明确返回一时为真，明确返回零时为假。
 * @throws 空值或其他结果表示锁状态无法确认。
 */
function readLockFlag(value: unknown): boolean {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  throw new Error('数据库锁状态无法确认');
}

/**
 * 在同一物理会话内管理获取、所有权和释放，异常会话不再回池，业务与清理错误均被保留。
 * @param session - 已绑定单一物理连接的查询与丢弃能力。
 * @param name - 不改变既有竞争边界的锁键。
 * @param waitSeconds - 调用方声明的有界等待秒数。
 * @param action - 只在获锁后执行的业务操作。
 * @returns 竞争失败或业务结果；租约在回调结束后停止接受所有权查询。
 * @throws 数据库状态未知、锁已丢失或业务失败时拒绝完成；双重失败保留两个原因。
 */
async function withLockSession<T>(
  session: LockSession,
  name: string,
  waitSeconds: number,
  action: (lease: LockLease) => Promise<T>,
): Promise<LockResult<T>> {
  try {
    const rows = await lockQuery(
      session,
      'SELECT GET_LOCK(?, ?) AS acquired',
      [name, waitSeconds],
      waitSeconds,
    );
    if (!readLockFlag(rows[0]?.acquired)) return { acquired: false };
  } catch (error) {
    session.discard();
    throw error;
  }
  let active = true;
  let ownershipFailed = false;
  let ownershipError: unknown;
  let actionFailed = false;
  let actionError: unknown;
  const lease: LockLease = Object.freeze({
    name,
    isOwned: async () => {
      if (!active) return false;
      try {
        const rows = await lockQuery(
          session,
          'SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned',
          [name],
        );
        if (!active) return false;
        const owned = readLockFlag(rows[0]?.owned);
        if (!owned) {
          ownershipFailed = true;
          ownershipError = new Error('数据库锁所有权已丢失');
        }
        return owned;
      } catch (error) {
        ownershipFailed = true;
        ownershipError = error;
        throw error;
      }
    },
  });
  try {
    return { acquired: true, value: await action(lease) };
  } catch (error) {
    actionFailed = true;
    actionError = error;
    throw error;
  } finally {
    active = false;
    if (ownershipFailed) {
      session.discard();
      if (!actionFailed) throw ownershipError;
      if (actionError !== ownershipError)
        throw new AggregateError(
          [actionError, ownershipError],
          '业务执行与数据库锁所有权核对均失败',
          { cause: actionError },
        );
    } else {
      try {
        const rows = await lockQuery(
          session,
          'SELECT RELEASE_LOCK(?) AS released',
          [name],
        );
        if (!readLockFlag(rows[0]?.released))
          throw new Error('数据库锁在操作完成前已丢失');
      } catch (error) {
        session.discard();
        if (actionFailed)
          throw new AggregateError(
            [actionError, error],
            '业务执行与数据库锁释放均失败',
            { cause: actionError },
          );
        throw error;
      }
    }
  }
}

/**
 * 为所有 API 模块借用独占连接持有资源锁，事务由回调决定，连接在全部退出路径归还或丢弃。
 * @param database - API 全局 MySQL 数据源。
 * @param name - 模块声明的资源锁键。
 * @param waitSeconds - 获取锁的等待秒数。
 * @param action - 使用同一连接管理器和可选所有权探针执行的业务操作。
 * @returns 繁忙状态或操作结果。
 * @throws 无法获取确定状态、操作失败或清理失败时传播错误。
 */
export async function withDatabaseLock<T>(
  database: DataSource,
  name: string,
  waitSeconds: number,
  action: (manager: EntityManager, lease: LockLease) => Promise<T>,
): Promise<LockResult<T>> {
  validateLockRequest(name, waitSeconds);
  const runner = database.createQueryRunner();
  try {
    const session: Pick<PoolConnection, 'destroy'> = await runner.connect();
    return await withLockSession(
      {
        query: (sql, parameters) => runner.query(sql, parameters),
        discard: () => session?.destroy(),
      },
      name,
      waitSeconds,
      (lease) => action(runner.manager, lease),
    );
  } finally {
    await runner.release();
  }
}

/**
 * 让迁移命令复用已建立的 mysql2 连接持锁，正常退出保留连接，异常会话记录为已丢弃。
 * @param connection - 调用方创建并持有的 mysql2 连接。
 * @param name - 与既有迁移互通的稳定锁键。
 * @param waitSeconds - 获取迁移锁的等待秒数。
 * @param action - 获锁后执行的原迁移操作，事务与 SQL 内容保持由调用方管理。
 * @returns 繁忙状态或迁移操作结果。
 * @throws 锁状态不确定、操作或释放失败时拒绝完成。
 */
export async function withMysqlConnectionLock<T>(
  connection: Connection,
  name: string,
  waitSeconds: number,
  action: (lease: LockLease) => Promise<T>,
): Promise<LockResult<T>> {
  validateLockRequest(name, waitSeconds);
  return withLockSession(
    {
      query: async (sql, parameters) => {
        const [rows] = await connection.query<RowDataPacket[]>(sql, parameters);
        return rows;
      },
      discard: () => {
        discardedConnections.add(connection);
        connection.destroy();
      },
    },
    name,
    waitSeconds,
    action,
  );
}

/**
 * 关闭迁移命令持有的连接，已因锁错误丢弃的连接不重复发送结束命令以免覆盖原始错误。
 * @param connection - 曾交给全局锁能力使用的 mysql2 连接。
 */
export async function closeMysqlLockConnection(
  connection: Connection,
): Promise<void> {
  if (discardedConnections.has(connection)) return;
  await connection.end();
}
