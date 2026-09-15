import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  statSync,
  chownSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 48 * 1024;

/**
 * 验证 API 投影中的单调版本、会话摘要和内容摘要，拒绝路径与正文注入。
 * @param input - 私有 Dashboard 收到的原始 JSON 字符串。
 * @returns 可安全写入原生人格目录的清单和原始载荷摘要。
 * @throws 载荷超过上限、引用缺失或摘要不一致时拒绝发布。
 */
export function parseProjection(input) {
  if (Buffer.byteLength(input) > MAX_BYTES) throw new Error('人格清单超过上限');
  const value = JSON.parse(input);
  const hash = (key) => typeof key === 'string' && /^[a-f0-9]{64}$/u.test(key);
  if (
    value?.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    throw new Error('人格清单修订错误');
  if (
    !value.souls ||
    typeof value.souls !== 'object' ||
    Array.isArray(value.souls)
  )
    throw new Error('人格正文集合错误');
  if (
    !value.bindings ||
    typeof value.bindings !== 'object' ||
    Array.isArray(value.bindings)
  )
    throw new Error('人格会话映射错误');
  if (Object.keys(value.bindings).length > 256 || !hash(value.fallback))
    throw new Error('人格清单边界错误');
  for (const [key, content] of Object.entries(value.souls)) {
    if (
      !hash(key) ||
      typeof content !== 'string' ||
      content.length > 8000 ||
      createHash('sha256').update(content).digest('hex') !== key
    )
      throw new Error('人格正文摘要不一致');
  }
  if (
    !Object.hasOwn(value.souls, value.fallback) ||
    Object.entries(value.bindings).some(
      ([key, id]) => !hash(key) || !hash(id) || !Object.hasOwn(value.souls, id),
    )
  )
    throw new Error('人格清单引用缺失');
  return { ...value, digest: createHash('sha256').update(input).digest('hex') };
}

/**
 * 继承 Hermes 数据目录的所有者，写入后刷盘并原子替换，避免读到半份人格正文。
 * @param path - 由固定目录和验证摘要构造的目标路径。
 * @param content - 待持久化文本。
 * @param owner - Hermes 数据目录的实际属主信息。
 */
function atomicWrite(path, content, owner) {
  const staged = path + '.' + randomUUID() + '.pending';
  writeFileSync(staged, content, { mode: 0o600, flag: 'wx' });
  chownSync(staged, owner.uid, owner.gid);
  const file = openSync(staged, 'r');
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(staged, path);
}

/**
 * 在调用方持有文件锁时发布不可变正文与原子清单，旧修订不能覆盖较新会话选择。
 * @param home - 已认证 Dashboard 解析出的真实 Hermes 档案目录。
 * @param input - 完整 API 发布载荷。
 * @returns 已落盘的修订号与摘要。
 * @throws 回退修订、同修订不同载荷或文件持久化失败时拒绝确认。
 */
export function publish(home, input) {
  const value = parseProjection(input);
  const root = join(home, '.kt-conversation-souls');
  const owner = statSync(home);
  const ensure = (dir) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    chownSync(dir, owner.uid, owner.gid);
  };
  ensure(root);
  const manifest = join(root, 'current.json');
  if (existsSync(manifest)) {
    const current = JSON.parse(readFileSync(manifest, 'utf8'));
    if (
      !Number.isSafeInteger(current.revision) ||
      !/^[a-f0-9]{64}$/u.test(current.digest)
    )
      throw new Error('现有清单损坏');
    if (
      current.revision > value.revision ||
      (current.revision === value.revision && current.digest !== value.digest)
    )
      throw new Error('人格发布版本冲突');
  }
  for (const [id, content] of Object.entries(value.souls)) {
    const dir = join(root, id);
    ensure(dir);
    atomicWrite(join(dir, 'SOUL.md'), content, owner);
    const handle = openSync(dir, 'r');
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  }
  atomicWrite(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      revision: value.revision,
      digest: value.digest,
      fallback: value.fallback,
      bindings: value.bindings,
    }),
    owner,
  );
  const handle = openSync(root, 'r');
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  return { ok: true, revision: value.revision, digest: value.digest };
}

/**
 * 只返回当前原子清单的版本与摘要，不向管理查询重复传送人格正文。
 * @param home - Hermes 档案数据目录。
 * @returns 已发布的修订摘要，尚未初始化时返回零修订。
 */
export function inspect(home) {
  const path = join(home, '.kt-conversation-souls/current.json');
  if (!existsSync(path)) return { revision: 0, digest: null };
  const value = JSON.parse(readFileSync(path, 'utf8'));
  return { revision: value.revision, digest: value.digest };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [method, home] = process.argv.slice(2);
    let result;
    if (method === 'read') result = inspect(home);
    else if (method === 'write')
      result = publish(home, readFileSync(0, 'utf8'));
    else throw new Error('不支持的人格操作');
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(String(error.message));
    process.exitCode = 1;
  }
}
