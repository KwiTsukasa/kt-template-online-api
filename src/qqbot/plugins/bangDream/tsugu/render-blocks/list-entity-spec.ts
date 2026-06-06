export const BANGDREAM_ENTITY_LIST_SPEC = {
  multiValueSpacing: 0,
} as const;

/**
 * 判断实体列表是否应展示为单实体名称行。
 *
 * @param contentLength - 实体数量。
 * @param text - 外部指定展示文本。
 */
export function shouldUseSingleEntityLabel(
  contentLength: number,
  text?: string,
) {
  return contentLength === 1 && text == null;
}
