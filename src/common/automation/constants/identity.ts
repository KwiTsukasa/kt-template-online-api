export const AUTOMATION_DIGEST_ALGORITHM = 'sha256';
export const AUTOMATION_DIGEST_ENCODING = 'hex';
export const DEFINITION_RECORD_ERROR = {
  shape: '定义必须是普通对象',
  prototype: '定义不允许自定义原型',
} as const;
export const FORBIDDEN_OBJECT_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export const AUTOMATION_DATA_LIMITS = Object.freeze({
  fields: 64,
  labelLength: 80,
  textLength: 16_384,
  options: 100,
});
export const JSON_KEY_ORDER = { smallGroup: 16, byteBuckets: 257 } as const;
