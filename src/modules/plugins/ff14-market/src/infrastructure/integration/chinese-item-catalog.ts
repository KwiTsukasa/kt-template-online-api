import type { XivapiSearchItem } from '../../domain/ff14-market.types';

/**
 * 读取数据维护方的物品CSV，以表头定位字段，正确保留描述中的换行、逗号和转义引号。
 * @param text - 最新中文物品数据的UTF-8正文。
 * @returns 按游戏物品ID索引的名称、交易属性、图标与等级，不包含原始描述。
 * @throws CSV引号未闭合、必要字段缺失或没有有效物品时拒绝使用数据。
 */
export function parseChineseItemCatalog(
  text: string,
): Map<number, XivapiSearchItem> {
  const items = new Map<number, XivapiSearchItem>();
  let fields: string[] = [];
  let cell = '';
  let quoted = false;
  let headers: string[] = [];
  const consume = () => {
    fields.push(cell);
    cell = '';
    if (fields[0] === '#') headers = fields;
    else if (/^\d+$/u.test(fields[0]) && headers.length) {
      const name = fields[headers.indexOf('Name')];
      const trade = fields[headers.indexOf('IsUntradable')];
      if (name && /^(True|False)$/u.test(trade || '')) {
        const itemId = Number(fields[0]);
        items.set(itemId, {
          row_id: itemId,
          sheet: 'Item',
          fields: {
            Name: name,
            IsUntradable: trade === 'True',
            LevelItem: Number(fields[headers.indexOf('Level{Item}')]),
          },
        });
      }
    }
    fields = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === ',') {
      fields.push(cell);
      cell = '';
    } else if (!quoted && char === '\n') consume();
    else if (char !== '\r' || quoted) cell += char;
  }
  if (quoted) throw new Error('中文物品CSV引号未闭合');
  if (cell || fields.length) consume();
  if (
    !headers.includes('Name') ||
    !headers.includes('IsUntradable') ||
    !items.size
  )
    throw new Error('中文物品CSV缺少必要字段或有效数据');
  return items;
}
