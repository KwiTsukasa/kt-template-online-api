const DEFAULT_NAPCAT_WEBUI_PUBLIC_BASE_URL = '/admin/napcat-webui';
const ROOT_RELATIVE_PUBLIC_PATH_PATTERN = /^\/[A-Za-z0-9._~/-]+$/;

/**
 * 把配置值收敛为非根目录的安全站内路径，省略配置时使用默认的 NapCat WebUI 前缀。
 * @param value - 待规范化的公开路径；缺失或为空时使用默认前缀。
 * @returns 去除空路径段后、以单个斜杠开头的公开基础路径。
 * @throws 输入不是站内绝对路径、最终指向根目录或包含当前目录及父目录段时抛出 `Error`。
 */
export function resolveNapcatWebuiPublicBaseUrl(value?: string) {
  const rawValue = String(value || DEFAULT_NAPCAT_WEBUI_PUBLIC_BASE_URL).trim();

  if (
    !rawValue.startsWith('/') ||
    rawValue.startsWith('//') ||
    !ROOT_RELATIVE_PUBLIC_PATH_PATTERN.test(rawValue)
  ) {
    throw new Error(
      'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL must be a root-relative path',
    );
  }

  const segments = rawValue.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(
      'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL must not resolve to root',
    );
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(
        'NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL contains an unsafe segment',
      );
    }
  }

  return `/${segments.join('/')}`;
}
