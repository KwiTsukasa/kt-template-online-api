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
export type PersonaState = {
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

/**
 * 校验目录和同步记录；仅首次使用生成空默认人格，不覆盖损坏数据。
 * @param value - 宿主读取的原始状态；空值代表首次使用。
 * @returns 可独立修改的有效状态副本。
 * @throws 目录或同步记录异常时拒绝操作。
 */
export function readState(value: unknown): PersonaState {
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
  const state = value as PersonaState;
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
