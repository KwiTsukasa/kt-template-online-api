export const BANGDREAM_ENTITY_LIST_SPEC = {
  multiValueSpacing: 0,
} as const;

/**
 * 根据`contentLength`、`text`与当前约束判定实体列表是否应展示为单实体名称行。
 * @param contentLength - 限制实体列表是否应展示为单实体名称行数量、尺寸、等级或重试边界的数值。
 * @param text - 决定实体列表是否应展示为单实体名称行内容、边界或目标的 `text` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足实体列表是否应展示为单实体名称行约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
 */
export function shouldUseSingleEntityLabel(
  contentLength: number,
  text?: string,
) {
  return contentLength === 1 && text == null;
}
