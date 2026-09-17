import { requireDefinition } from '@/common/automation/validation';

import { DEFINITION_RECORD_ERROR } from './constants/identity';
export type PublishedReference = { id: string; version: number };

/**
 * 为一次校验批次合并同一固定版本的读取，重复节点共用同一契约对象和结果，不缓存到后续请求。
 * @param resolve - 所属资源提供的固定版本读取端口。
 * @returns 按资源身份及版本去重的本批读取函数。
 */
export function createPublishedResolver<T>(
  resolve: (reference: PublishedReference) => Promise<T>,
): (reference: PublishedReference) => Promise<T> {
  const versions = new Map<string, Promise<T>>();
  return (reference) => {
    const key = `${reference.id}:${reference.version}`;
    let value = versions.get(key);
    if (!value) {
      value = resolve(reference);
      versions.set(key, value);
    }
    return value;
  };
}

export type DefinitionDocument<T> = {
  id: string;
  name: string;
  description: string;
  revision: number;
  publishedVersion: number | null;
  definition: T;
};

export type DefinitionWrite<T = unknown> = {
  name: string;
  description?: string;
  definition: T;
  expectedRevision?: number;
};

/**
 * 限制持久定义为普通对象，防止原型对象或数组被当作字段字典。
 * @param input - 来自接口或持久化边界的定义。
 * @param message - 当前领域需要的错误说明，省略时使用公共对象约束说明。
 * @returns 可按自有属性读取的字段字典。
 * @throws 输入不是普通对象时拒绝读取。
 */
export function definitionRecord(
  input: unknown,
  message?: string,
): Record<string, unknown> {
  requireDefinition(
    input && typeof input === 'object' && !Array.isArray(input),
    message ?? DEFINITION_RECORD_ERROR.shape,
  );
  const prototype = Object.getPrototypeOf(input);
  requireDefinition(
    prototype === Object.prototype || prototype === null,
    message ?? DEFINITION_RECORD_ERROR.prototype,
  );
  return input as Record<string, unknown>;
}

/**
 * 检查不可变版本引用，避免使用最新草稿隐式替换已经发布的依赖。
 * @param input - 保存或执行时传入的依赖身份。
 * @returns 经过校验的资源标识与发布版本。
 * @throws 资源标识或发布版本非法时拒绝引用。
 */
export function publishedReference(input: unknown): PublishedReference {
  const value = definitionRecord(input);
  requireDefinition(
    typeof value.id === 'string' &&
      /^[1-9]\d{0,19}$/.test(value.id) &&
      Number.isSafeInteger(value.version) &&
      Number(value.version) >= 1,
    '依赖必须指定资源 ID 和正整数发布版本',
  );
  return { id: value.id, version: Number(value.version) };
}
