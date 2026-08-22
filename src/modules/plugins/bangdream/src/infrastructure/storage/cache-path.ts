import {
  bestdoriUrl,
  cacheRootPath,
} from '@/modules/plugins/bangdream/src/config/runtime-config';
import { resolveBangDreamProviderUrl } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import * as path from 'path';

/**
 * 将资源 URL 的主机、目录与查询串清理为安全目录名，并拼接到 BanG Dream 缓存根目录。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @returns 缓存目录。
 */
export function getCacheDirectory(url: string): string {
  const urlObj = new URL(resolveCacheUrl(url));
  let pathname = urlObj.pathname;
  // 如果结尾是文件名，去掉文件名
  if (path.basename(pathname).indexOf('.') != -1) {
    pathname = path.dirname(pathname);
  }
  let cacheDir = path.join(urlObj.host, pathname, urlObj.search);
  // 处理非法字符
  cacheDir = sanitizeDirectoryName(cacheDir);

  return path.join(cacheRootPath, cacheDir);
}

/**
 * 按`url`读取文件名称URL 地址。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @returns 文件名称URL 地址。
 */
export function getFileNameFromUrl(url: string): string {
  const urlObj = new URL(resolveCacheUrl(url));
  let fileName = path.basename(urlObj.pathname);

  // Remove query string if present
  const queryStringIndex = fileName.indexOf('?');
  if (queryStringIndex !== -1) {
    fileName = fileName.slice(0, queryStringIndex);
  }

  // Append .json if the file extension is missing
  const extension = path.extname(fileName);
  if (extension === '') {
    fileName += '.json';
  }

  return fileName;
}

/**
 * 将`dirName`规范为目录名称，使等价输入得到一致表示。
 * @param dirName - 决定目录名称内容、边界或目标的 `dirName` 值。
 * @returns 目录名称。
 */
function sanitizeDirectoryName(dirName: string): string {
  const illegalChars = /[/?<>:*|"]/g; // 定义非法字符的正则表达式
  const replacementChar = '_'; // 替代非法字符的字符

  return dirName.replace(illegalChars, replacementChar);
}

/**
 * 去除资源地址两端空白并解析为 Bestdori 提供方 URL；空地址时抛出错误。
 * @param url - 待规范化、请求或同源校验的URL 地址 URL。
 * @returns 缓存URL 地址。
 * @throws 当 `!source` 成立时拒绝当前输入并抛出 `Error`。
 */
function resolveCacheUrl(url: string): string {
  const source = `${url || ''}`.trim();
  if (!source) {
    throw new Error('cache url is empty');
  }
  return resolveBangDreamProviderUrl(bestdoriUrl, source);
}
