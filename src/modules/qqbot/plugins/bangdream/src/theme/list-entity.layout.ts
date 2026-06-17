export const BANGDREAM_ENTITY_LIST_SPEC = {
  multiValueSpacing: 0,
} as const;

/**
 * 判断实体列表是否应展示为单实体名称行。
 *
 * @param contentLength - contentLength 输入；计算 BangDream判断结果。
 * @param text - 待匹配文本；计算 BangDream判断结果。
 */
export function shouldUseSingleEntityLabel(
  contentLength: number,
  text?: string,
) {
  return contentLength === 1 && text == null;
}
