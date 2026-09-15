import { createHash } from 'node:crypto';
import { isPersonaName } from './command';
import {
  readProfileResult,
  isOfficialBotSelfId,
  type Avatar,
  type ProfileResult,
} from './profile-client';
export type Persona = {
  name: string;
  content: string;
  version: number;
  avatar?: Avatar;
};
type LegacyPersonaState = {
  schemaVersion: 1;
  profiles: Persona[];
  current: Persona;
  previous: Persona | null;
  pending: {
    target: Persona;
    retryAfter: number;
    jobId?: string;
    botSelfId?: string;
  } | null;
  botProfile?: ProfileResult & { target: Persona };
};

export type PersonaState = {
  schemaVersion: 2;
  profiles: Persona[];
  versions: Record<string, Persona>;
  fallback: string;
  bindings: Record<
    string,
    { current: string; desired: string; previous: string | null }
  >;
  soulRevision: number;
  publishedRevision: number;
};

/**
 * 将名称、版本、正文和头像摘要按固定顺序散列，避免不同人格快照共用存储键。
 * @param persona - 已校验的人格版本与头像标识。
 * @returns 该版本的稳定摘要。
 */
export function personaId(persona: Persona): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        persona.name,
        persona.version,
        persona.content,
        persona.avatar?.hash || '',
      ]),
    )
    .digest('hex');
}

/**
 * 将旧共享选择迁移为默认值，并验证每个会话的版本引用，损坏状态不会被重置。
 * @param value - API 私有存储中的旧版或新版快照。
 * @returns 保留目录、正文与既有选择的独立状态副本。
 * @throws 版本、会话键或引用损坏时拒绝继续写入。
 */
export function readState(value: unknown): PersonaState {
  const raw = value as PersonaState | null;
  if (!raw || Number(raw.schemaVersion) === 1) {
    const legacy = readLegacyState(value);
    const fallback = personaId(legacy.current);
    return {
      schemaVersion: 2,
      profiles: legacy.profiles,
      versions: { [fallback]: legacy.current },
      fallback,
      bindings: {},
      soulRevision: 1,
      publishedRevision: 0,
    };
  }
  if (
    raw.schemaVersion !== 2 ||
    !Array.isArray(raw.profiles) ||
    raw.profiles.length < 1 ||
    raw.profiles.length > 30
  )
    throw new Error('人格目录结构损坏。');
  if (
    !raw.profiles.every(isPersona) ||
    new Set(raw.profiles.map((item) => item.name)).size !==
      raw.profiles.length ||
    !raw.profiles.some(
      (item) =>
        item.name === '默认' && item.version === 0 && item.content === '',
    )
  )
    throw new Error('人格目录版本或默认项损坏。');
  if (
    !raw.versions ||
    Array.isArray(raw.versions) ||
    !raw.bindings ||
    Array.isArray(raw.bindings)
  )
    throw new Error('人格映射结构损坏。');
  if (
    Object.keys(raw.bindings).length > 256 ||
    !Number.isSafeInteger(raw.soulRevision) ||
    raw.soulRevision < 1
  )
    throw new Error('人格映射数量或修订异常。');
  if (
    !Number.isSafeInteger(raw.publishedRevision) ||
    raw.publishedRevision < 0 ||
    raw.publishedRevision > raw.soulRevision
  )
    throw new Error('会话人格状态损坏，未修改当前人格。');
  const validReference = (key: unknown) =>
    typeof key === 'string' &&
    /^[a-f0-9]{64}$/u.test(key) &&
    Object.hasOwn(raw.versions, key);
  if (
    !validReference(raw.fallback) ||
    Object.entries(raw.versions).some(
      ([key, item]) => !isPersona(item) || personaId(item) !== key,
    )
  )
    throw new Error('人格版本引用损坏。');
  for (const [key, binding] of Object.entries(raw.bindings)) {
    if (
      !/^[a-f0-9]{64}$/u.test(key) ||
      !binding ||
      !validReference(binding.current) ||
      !validReference(binding.desired)
    )
      throw new Error('会话人格引用损坏。');
    if (binding.previous !== null && !validReference(binding.previous))
      throw new Error('会话上一人格引用损坏。');
  }
  return structuredClone(raw);
}

/**
 * 仅更新指定会话的期望版本，旧版本继续作为确认值，其他会话不变。
 * @param state - API 最后读取的状态。
 * @param scope - 宿主提供的可信会话摘要。
 * @param target - 本轮明确选择的人格版本。
 * @returns 待发布到 Hermes 的新版状态。
 * @throws 会话键非法、目录已满或版本溢出时拒绝更新。
 */
export function selectPersona(
  state: PersonaState,
  scope: string,
  target: Persona,
): PersonaState {
  if (!/^[a-f0-9]{64}$/u.test(scope) || !isPersona(target))
    throw new Error('会话人格目标无效。');
  const next = structuredClone(state);
  if (!next.bindings[scope] && Object.keys(next.bindings).length >= 256)
    throw new Error('人格会话数量已达上限。');
  const id = personaId(target);
  next.versions[id] = structuredClone(target);
  const binding = next.bindings[scope] || {
    current: next.fallback,
    desired: next.fallback,
    previous: null,
  };
  if (binding.desired !== id || !next.bindings[scope]) next.soulRevision++;
  if (!Number.isSafeInteger(next.soulRevision))
    throw new Error('人格同步版本超出范围。');
  binding.desired = id;
  next.bindings[scope] = binding;
  return compactVersions(next);
}

/**
 * 核验完成后确认同一发布版本内的选择，保留各会话自己的上一版本。
 * @param state - 尚未被新切换替换的已发布状态。
 * @returns 确认值与期望值一致的状态。
 */
export function confirmSelections(state: PersonaState): PersonaState {
  const next = structuredClone(state);
  for (const binding of Object.values(next.bindings)) {
    if (binding.current !== binding.desired) binding.previous = binding.current;
    binding.current = binding.desired;
  }
  next.publishedRevision = next.soulRevision;
  return compactVersions(next);
}

/**
 * 移除不再被默认值或任何会话引用的旧快照，避免正文随会话数量重复增长。
 * @param state - 可原地整理的已复制状态。
 * @returns 仅包含仍被引用版本的状态。
 */
export function compactVersions(state: PersonaState): PersonaState {
  const used = new Set([state.fallback]);
  for (const binding of Object.values(state.bindings)) {
    used.add(binding.current);
    used.add(binding.desired);
    if (binding.previous) used.add(binding.previous);
  }
  for (const key of Object.keys(state.versions))
    if (!used.has(key)) delete state.versions[key];
  return state;
}

/**
 * 投影为 Hermes 的原生人格文件清单，正文按摘要复用且不进入普通聊天请求。
 * @param state - API 权威目录及期望选择。
 * @returns 带单调版本、默认正文和会话映射的发布载荷。
 */
export function soulProjection(state: PersonaState) {
  const souls: Record<string, string> = {};
  const include = (id: string) => {
    const content = state.versions[id].content;
    const hash = createHash('sha256').update(content).digest('hex');
    souls[hash] = content;
    return hash;
  };
  const fallback = include(state.fallback);
  const bindings: Record<string, string> = {};
  for (const scope of Object.keys(state.bindings).sort())
    bindings[scope] = include(state.bindings[scope].desired);
  return {
    schemaVersion: 1,
    revision: state.soulRevision,
    fallback,
    bindings,
    souls,
  };
}

/**
 * 校验目录和同步记录；仅首次使用生成空默认人格，不覆盖损坏数据。
 * @param value - 宿主读取的原始状态；空值代表首次使用。
 * @returns 可独立修改的有效状态副本。
 * @throws 目录或同步记录异常时拒绝操作。
 */
function readLegacyState(value: unknown): LegacyPersonaState {
  if (value === null) {
    const initial = { name: '默认', content: '', version: 0 };
    return {
      schemaVersion: 1,
      profiles: [initial],
      current: { ...initial },
      previous: null,
      pending: null,
    };
  }
  const state = value as LegacyPersonaState;
  if (
    !state ||
    state.schemaVersion !== 1 ||
    !Array.isArray(state.profiles) ||
    state.profiles.length < 1 ||
    state.profiles.length > 30
  ) {
    throw new Error('人格目录格式异常，未修改当前人格。');
  }
  if (
    !state.profiles.every(isPersona) ||
    new Set(state.profiles.map((item) => item.name)).size !==
      state.profiles.length ||
    !state.profiles.some(
      (item) =>
        item.name === '默认' && item.content === '' && item.version === 0,
    )
  ) {
    throw new Error('人格目录存在非法名称或默认项，未修改当前人格。');
  }
  if (
    !isPersona(state.current) ||
    (state.previous !== null && !isPersona(state.previous))
  ) {
    throw new Error('已确认的人格版本异常，未修改当前人格。');
  }
  if (state.pending !== null) {
    if (
      state.pending?.botSelfId !== undefined &&
      !isOfficialBotSelfId(state.pending.botSelfId)
    )
      throw new Error('待同步的官方账号身份异常。');
    if (
      !state.pending ||
      !isPersona(state.pending.target) ||
      !Number.isSafeInteger(state.pending.retryAfter) ||
      state.pending.retryAfter < 0
    ) {
      throw new Error('待同步的人格记录异常，未修改当前人格。');
    }
  }
  if (state.botProfile) {
    if (
      !isPersona(state.botProfile.target) ||
      !state.botProfile.target.avatar ||
      !/^[a-f0-9-]{36}$/u.test(state.botProfile.id)
    )
      throw new Error('Bot 资料同步身份异常。');
    readProfileResult(state.botProfile, state.botProfile.id);
  }
  if (state.pending?.jobId && !/^[a-f0-9-]{36}$/u.test(state.pending.jobId))
    throw new Error('人格同步身份异常。');
  return structuredClone(state);
}

/**
 * 保存下一版草稿，不改变当前人格或写入 Hermes。
 * @param state - 已验证的状态。
 * @param name - 目标人格名称。
 * @param content - 完整人格正文。
 * @param avatar - NAS 已持久化的头像摘要；旧目录记录可不含头像。
 * @returns 包含新草稿版本的状态。
 * @throws 默认名称受保护、正文非法或目录达到上限时拒绝保存。
 */
export function savePersona(
  state: PersonaState,
  name: string,
  content: string,
  avatar?: Avatar,
): PersonaState {
  if (name === '默认') throw new Error('默认人格保持为空，请使用其他名称。');
  const next = structuredClone(state);
  const index = next.profiles.findIndex((item) => item.name === name);
  let version = 1;
  if (index >= 0) version = next.profiles[index].version + 1;
  const target: Persona = { name, content, version };
  if (avatar) target.avatar = avatar;
  if (!isPersona(target) || !content.trim())
    throw new Error('请提供有效名称和非空正文，正文最多 8000 字。');
  if (index >= 0) next.profiles[index] = target;
  else {
    if (next.profiles.length >= 30)
      throw new Error('已保存 30 个人格，暂不能增加。');
    next.profiles.push(target);
  }
  return next;
}

/**
 * 拒绝非法名称、超长正文和被改写的默认人格，只接受非负整数版本。
 * @param value - 待验证的人格记录。
 * @returns 是否满足名称、正文长度与版本约束。
 */
function isPersona(value: unknown): value is Persona {
  const item = value as Persona;
  if (!item || !isPersonaName(item.name)) return false;
  if (typeof item.content !== 'string' || item.content.length > 8000)
    return false;
  if (item.avatar && !/^[a-f0-9]{64}$/u.test(item.avatar.hash)) return false;
  if (item.name === '默认' && (item.content !== '' || item.version !== 0))
    return false;
  return Number.isSafeInteger(item.version) && item.version >= 0;
}
