import { orderJsonKeys } from '@/common/automation/json-key-order';
import { normalizeMessageValue } from '@/modules/workflow-engine/domain/workflow-message.policy';

describe('消息 JSON 键的确定性顺序', () => {
  it('中文、空键、零字符、代理码元和公共前缀均保持原字符串排序结果', () => {
    const keys = [
      '',
      '\0',
      'a',
      'A',
      'a_',
      'a\0',
      'a😀',
      'a\ud800',
      'a\udfff',
      '中',
      '文',
      '中文',
      ...Array.from(
        { length: 400 },
        (_, index) =>
          `common-prefix-${String.fromCharCode((index * 131) % 65536)}${index}`,
      ),
    ];
    const original = [...keys];
    expect(orderJsonKeys(keys)).toEqual([...keys].sort());
    expect(keys).toEqual(original);
  });
  it('大字典只对最多十六项的分组做比较排序，键顺序仍与原生规则一致', () => {
    const keys = Array.from(
      { length: 10_000 },
      (_, index) => `key-${(index * 7919) % 10_000}`,
    );
    const expected = [...keys].sort();
    const sort = Array.prototype.sort;
    const sizes: number[] = [];
    const spy = jest
      .spyOn(Array.prototype, 'sort')
      .mockImplementation(function (compare) {
        sizes.push(this.length);
        return sort.call(this, compare);
      });
    let actual: string[];
    try {
      actual = orderJsonKeys(keys);
    } finally {
      spy.mockRestore();
    }
    expect(actual).toEqual(expected);
    expect(sizes.every((size) => size <= 16)).toBe(true);
  });
  it('嵌套消息的规范序列化保持字节一致，字段顺序不改变幂等摘要输入', () => {
    const values = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [
        `key-${50 - index}`,
        { b: 2, a: 1 },
      ]),
    );
    const expected = Object.fromEntries(
      Object.keys(values)
        .sort()
        .map((key) => [key, { a: 1, b: 2 }]),
    );
    expect(JSON.stringify(normalizeMessageValue(values))).toBe(
      JSON.stringify(expected),
    );
  });
});
