import {
  bestdoriUrl,
  cacheRootPath,
} from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { resolveBangDreamProviderUrl } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import * as path from 'path';

/**
 * 在数据下载与缓存层中获取缓存Directory。
 *
 * @param url - 访问地址；驱动 `URL()` 的 BangDream步骤。
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
 * 查询 BangDream 插件数据。
 *
 * @param url - 访问地址；驱动 `URL()` 的 BangDream步骤。
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
 * @param dirName - dirName 输入；生成规范化文本。
 * @returns 格式化后的文本。
 */
function sanitizeDirectoryName(dirName: string): string {
  const illegalChars = /[/?<>:*|"]/g; // 定义非法字符的正则表达式
  const replacementChar = '_'; // 替代非法字符的字符

  return dirName.replace(illegalChars, replacementChar);
}

/**
 * 解析Cache Url。
 * @param url - 访问地址；驱动 `Error()` 的 BangDream步骤。
 * @returns BangDream 插件渲染后的图片、画布或文本。
 */
function resolveCacheUrl(url: string): string {
  const source = `${url || ''}`.trim();
  if (!source) {
    throw new Error('cache url is empty');
  }
  return resolveBangDreamProviderUrl(bestdoriUrl, source);
}
