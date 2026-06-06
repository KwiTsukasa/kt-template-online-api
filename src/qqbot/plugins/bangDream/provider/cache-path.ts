import {
  bestdoriUrl,
  cacheRootPath,
} from '@/qqbot/plugins/bangDream/config/runtime-config';
import { resolveBangDreamProviderUrl } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import * as path from 'path';

/**
 * 在数据下载与缓存层中获取缓存Directory。
 *
 * @param url - 远端资源地址。
 * @returns 格式化后的文本。
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
 * 在数据下载与缓存层中获取File名称FromURL。
 *
 * @param url - 远端资源地址。
 * @returns 格式化后的文本。
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
 * 在数据下载与缓存层中处理sanitizeDirectory名称。
 *
 * @param dirName - dir名称参数。
 * @returns 格式化后的文本。
 */
function sanitizeDirectoryName(dirName: string): string {
  const illegalChars = /[/?<>:*|"]/g; // 定义非法字符的正则表达式
  const replacementChar = '_'; // 替代非法字符的字符

  return dirName.replace(illegalChars, replacementChar);
}

function resolveCacheUrl(url: string): string {
  const source = `${url || ''}`.trim();
  if (!source) {
    throw new Error('cache url is empty');
  }
  return resolveBangDreamProviderUrl(bestdoriUrl, source);
}
