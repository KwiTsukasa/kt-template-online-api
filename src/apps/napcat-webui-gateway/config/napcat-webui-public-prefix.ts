const DEFAULT_NAPCAT_WEBUI_PUBLIC_BASE_URL = '/admin/napcat-webui';
const ROOT_RELATIVE_PUBLIC_PATH_PATTERN = /^\/[A-Za-z0-9._~/-]+$/;

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
