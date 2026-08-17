import type {
  DecodeDictKeyOptions,
  DictDecodeRule,
  KtDictOption,
} from '../types';

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
/**
 * 根据`dictKeys`、`options`拼接稳定的字典键，用于隔离对应资源或存储记录。
 * @param dictKeys - 用于批量校验或读取字典键的键集合；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param options - 控制字典键筛选、缓存或输出方式的可选项，包含 `sourceKey`、`targetKey` 字段；省略时默认采用 `{}`。
 * @returns 字典键。
 */
export function DecodeDictKey(
  dictKeys?: string | string[],
  options: DecodeDictKeyOptions = {},
): PropertyDecorator {
  return (target, key: string | symbol) => {
    const currentKey = key.toString();
    const sourceKey = options.sourceKey || currentKey;
    const targetKey = options.targetKey || currentKey;
    const sourceDictKeys = (() => {
      if (Array.isArray(dictKeys)) {
        return dictKeys;
      }
      if (dictKeys) {
        return [dictKeys];
      }
      return [];
    })();
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
/**
 * 从`target`解析针对字典翻译；从 `getDecodeRules` 读取针对字典翻译。
 * @param target - 用于针对字典翻译的领域对象，包含 `sourceKey`、`targetKey` 字段。
 * @returns 针对字典翻译。
 */
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
/**
 * 根据`dicts`更新字典缓存；同步更新对应缓存或去重状态（`DICT_DECODE_CACHE.clear`）。
 * @param dicts - 决定字典缓存内容、边界或目标的 `dicts` 值。
 */
export function setDictDecodeCache(
  dicts: Array<KtDictOption<{ dictKey: string }>>,
): void {
  DICT_DECODE_CACHE.clear();

  dicts.forEach(({ dictKey, value, label }) => {
    if (!DICT_DECODE_CACHE.has(dictKey)) {
      DICT_DECODE_CACHE.set(dictKey, new Map());
    }

    DICT_DECODE_CACHE.get(dictKey).set(getDictValueKey(value), label);
  });
}
