export type PublishedReference = { id: string; version: number };

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
 * @returns 可按自有属性读取的字段字典。
 * @throws 输入不是普通对象时拒绝读取。
 */
export function definitionRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('定义必须是普通对象');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('定义不允许自定义原型');
  }
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
  if (
    typeof value.id !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(value.id) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1
  ) {
    throw new Error('依赖必须指定资源 ID 和正整数发布版本');
  }
  return { id: value.id, version: Number(value.version) };
}
