const ADMIN_TOKEN_SECRET_MIN_LENGTH = 32;

const INSECURE_ADMIN_TOKEN_SECRETS = new Set([
  'change-me',
  'kt-template-online-admin-token-secret',
]);

/**
 * 判断 Admin 令牌密钥是否满足生产签名强度且不是已知占位值。
 * @param value 运行环境读取到的候选密钥。
 * @returns 候选值是无首尾空白、至少 32 字符且不在占位值集合时返回 true。
 */
export function isSecureAdminTokenSecret(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length < ADMIN_TOKEN_SECRET_MIN_LENGTH) return false;
  return !INSECURE_ADMIN_TOKEN_SECRETS.has(value);
}

/**
 * 读取并验证 Admin 令牌密钥，拒绝缺失、弱值和历史默认值。
 * @param value 运行环境读取到的候选密钥。
 * @returns 可用于 HMAC 的稳定密钥。
 * @throws 候选值不满足生产密钥策略时抛出配置错误。
 */
export function requireSecureAdminTokenSecret(value: unknown): string {
  if (!isSecureAdminTokenSecret(value)) {
    throw new Error('ADMIN_TOKEN_SECRET 必须是至少 32 字符的非默认私有值');
  }
  return value;
}
