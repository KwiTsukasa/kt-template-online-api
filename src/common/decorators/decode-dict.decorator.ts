type DecodeDictKeyOptions = {
  fallback?: string;
  sourceKey?: string;
  targetKey?: string;
};

type DictDecodeRule = DecodeDictKeyOptions & {
  targetKey: string;
  dictKeys: string[];
};

const DICT_DECODE_RULES = Symbol('DICT_DECODE_RULES');
const DICT_DECODE_CACHE = new Map<string, Map<string, string>>();

const getDictValueKey = (value: unknown) => String(value);

// 字典翻译规则挂在类原型上，实例加载完成后再统一读取并执行。
const getDecodeRules = (target: object): DictDecodeRule[] => {
  const prototype = Object.getPrototypeOf(target);

  return prototype?.[DICT_DECODE_RULES] || [];
};

// 未指定 dictKey 时会在所有字典分组里查找，适合全局唯一的业务枚举值。
const getTargetDictMaps = (dictKeys: string[]) => {
  if (dictKeys.length) {
    return dictKeys
      .map((dictKey) => DICT_DECODE_CACHE.get(dictKey))
      .filter(Boolean);
  }

  return [...DICT_DECODE_CACHE.values()];
};

// 只登记翻译关系，不在 setter 中翻译，避免实体继承字段和 TypeORM 赋值顺序带来的覆盖问题。
export function DecodeDictKey(
  dictKeys?: string | string[],
  options: DecodeDictKeyOptions = {},
): PropertyDecorator {
  return (target, key: string | symbol) => {
    const currentKey = key.toString();
    const sourceKey = options.sourceKey || currentKey;
    const targetKey = options.targetKey || currentKey;
    const sourceDictKeys = Array.isArray(dictKeys)
      ? dictKeys
      : dictKeys
      ? [dictKeys]
      : [];
    const rules = target[DICT_DECODE_RULES] || [];

    target[DICT_DECODE_RULES] = [
      ...rules,
      {
        ...options,
        sourceKey,
        targetKey,
        dictKeys: sourceDictKeys,
      },
    ];
  };
}

// 在 TypeORM AfterLoad 等实体初始化完成后调用，将源字段值翻译到 targetKey。
export function decodeDictKeys<T extends object>(target: T): T {
  getDecodeRules(target).forEach(
    ({ sourceKey, targetKey, dictKeys, fallback }) => {
      const valueKey = getDictValueKey(target[sourceKey]);
      const label = getTargetDictMaps(dictKeys)
        .map((dictMap) => dictMap.get(valueKey))
        .find(Boolean);

      target[targetKey] = label || fallback || '';
    },
  );

  return target;
}

// DictService 从数据库刷新缓存后，实体 AfterLoad 可以同步完成字典映射。
export function setDictDecodeCache(
  dicts: Array<Dict<{ dictKey: string }>>,
): void {
  DICT_DECODE_CACHE.clear();

  dicts.forEach(({ dictKey, value, label }) => {
    if (!DICT_DECODE_CACHE.has(dictKey)) {
      DICT_DECODE_CACHE.set(dictKey, new Map());
    }

    DICT_DECODE_CACHE.get(dictKey).set(getDictValueKey(value), label);
  });
}
