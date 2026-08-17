export const NAPCAT_PHYSICAL_OUI_PREFIXES = [
  '00:1A:2B',
  '00:1B:21',
  '00:1E:67',
  '00:22:68',
  '00:24:D7',
  '00:25:90',
  '00:26:B9',
  '3C:97:0E',
  '44:8A:5B',
  '58:11:22',
  '6C:88:14',
  '70:85:C2',
  '84:2B:2B',
  'A0:36:9F',
  'B4:2E:99',
] as const;

export const NAPCAT_REJECTED_VIRTUAL_OUI_PREFIXES = [
  '02:42',
  '52:54:00',
  '00:05:69',
  '00:0C:29',
  '00:1C:14',
  '00:50:56',
  '00:15:5D',
  '00:03:FF',
] as const;

/**
 * 根据`macAddress`与当前约束判定被拒绝的虚拟的MAC前缀。
 * @param macAddress - 决定被拒绝的虚拟的MAC前缀内容、边界或目标的 `macAddress` 值。
 * @returns 满足被拒绝的虚拟的MAC前缀约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function isRejectedVirtualMacPrefix(macAddress: string) {
  const normalized = macAddress.toUpperCase();
  return NAPCAT_REJECTED_VIRTUAL_OUI_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toUpperCase()),
  );
}

/**
 * 根据`macAddress`与当前约束判定物理的OUIMAC前缀是否存在。
 * @param macAddress - 决定物理的OUIMAC前缀是否存在内容、边界或目标的 `macAddress` 值。
 * @returns 满足物理的OUIMAC前缀是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
export function hasPhysicalOuiMacPrefix(macAddress: string) {
  const normalized = macAddress.toUpperCase();
  return NAPCAT_PHYSICAL_OUI_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toUpperCase()),
  );
}
