export const PERSONA_HELP = [
  '/persona 与 /人格 均可使用：',
  's / 保存：发送以下文字并附带图片（只取第一张）：',
  '/persona s',
  '人格名（同时作为 Bot 名）',
  '人格正文（可多行）',
  'c / 切换：/persona c 人格名',
  'd / 删除：/persona d 人格名',
  'h / 使用说明：/persona h',
  '缺少图片、名称或正文时不保存。保存不自动切换。',
  '名称最多 20 字，正文最多 8000 字；图片支持 PNG、JPEG、WebP，最多 2 MiB。',
  '所有人格共享记忆并保留对话连续性；切换只改变当前身份、语气和行为。',
].join('\n');

export type PersonaCommand =
  | { action: 'help' }
  | { action: 'save'; name: string; content: string; imageUrl: string }
  | { action: 'switch' | 'delete'; name: string };

/**
 * 按独立名称行解析图文人格命令，只接受真实附件投影中的第一张图片。
 * @param input - 命令参数原文和宿主提供的图片地址列表。
 * @returns 已验证命令；缺图、无效名称或格式不符时返回空值。
 */
export function parsePersonaCommand(
  input: Record<string, unknown>,
): PersonaCommand | null {
  if (typeof input.raw !== 'string' || input.raw.length > 8200) return null;
  const raw = input.raw.replace(/\r\n?/gu, '\n').trim();
  if (/^(?:h|使用说明)$/u.test(raw) || !raw) return { action: 'help' };
  const selected = /^(c|切换|d|删除)[ \t]+([^\n]+)$/u.exec(raw);
  if (selected) {
    const name = selected[2].trim();
    if (!isPersonaName(name)) return null;
    let action: 'switch' | 'delete' = 'switch';
    if (selected[1] === 'd' || selected[1] === '删除') action = 'delete';
    return { action, name };
  }
  const saved = /^(?:s|保存)(?:[ \t]+|[ \t]*\n)([^\n]+)\n([\s\S]+)$/u.exec(raw);
  if (!saved || !Array.isArray(input.imageUrls)) return null;
  const name = saved[1].trim();
  const content = saved[2].trim();
  const imageUrl = input.imageUrls[0];
  if (
    !isPersonaName(name) ||
    !content ||
    content.length > 8000 ||
    typeof imageUrl !== 'string'
  )
    return null;
  try {
    const url = new URL(imageUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      imageUrl.length > 8192
    )
      return null;
  } catch {
    return null;
  }
  return { action: 'save', name, content, imageUrl };
}

/**
 * 限定可同时用于人格目录与 Bot 昵称的单行名称，避免控制字符及空白歧义。
 * @param value - 待保存或查找的名称。
 * @returns 名称是否在新版 Bot 昵称二十字符上限内且没有首尾空白。
 */
export function isPersonaName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length <= 20 &&
    /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}/\\]+$/u.test(value)
  );
}
