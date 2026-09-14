import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

/**
 * 仅允许公网地址，阻止网页重定向或 DNS 把 NAS 内网当作抓取目标。
 * @param address - 已解析的 IPv4 或 IPv6 地址。
 * @returns 是否属于允许直接连接的公网地址。
 */
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if ([0, 10, 127].includes(a) || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && [0, 168].includes(b)) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && [18, 19].includes(b)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/iu.test(address)) return false;
  const [first, second = ''] = address.toLowerCase().split(':');
  if (first === '2002' || first === '3fff') return false;
  if (
    first === '2001' &&
    (Number.parseInt(second || '0', 16) < 0x200 || second === 'db8')
  )
    return false;
  return true;
}

/**
 * 固定解析后的地址连接原始主机，保留 TLS 主机校验并限制总响应大小。
 * @param url - 已校验的公网 URL。
 * @param addresses - 当前主机已验证的地址列表。
 * @param signal - 整次抓取共用的截止信号。
 * @returns 状态、响应头与有界字节，不自动跟随重定向。
 */
function download(url, addresses, signal) {
  return new Promise((resolve, reject) => {
    let request = httpsRequest;
    if (url.protocol === 'http:') request = httpRequest;
    const req = request(
      url,
      {
        signal,
        headers: {
          'User-Agent': 'KT-Hermes-WebReader/1.0',
          Accept: 'text/html,text/plain,application/json;q=0.8',
          'Accept-Encoding': 'identity',
        },
        lookup: (_host, options, done) => {
          if (options.all) {
            done(null, addresses);
            return;
          }
          done(null, addresses[0].address, addresses[0].family);
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 3 * 1024 * 1024) {
            res.destroy(new Error('网页超过 3 MiB 限制'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * 从真实 HTML 提取正文，不执行脚本、不加载子资源，也不把登录或验证码页当答案。
 * @param html - 有界的网页原文。
 * @param source - 当前实际响应地址。
 * @returns 提取正文或明确的访问限制状态。
 */
export function extractPage(html, source) {
  const { document } = parseHTML(html);
  const title = document.title || '';
  const original = document.body?.textContent || '';
  if (
    document.querySelector('input[type=password]') ||
    (/captcha|access denied|just a moment|安全验证|人机验证/iu.test(title) &&
      original.length < 5000)
  )
    return {
      status: 'access_required',
      title,
      source,
      reason: '页面要求登录或验证；未把验证页作为正文。',
    };
  document
    .querySelectorAll('script,style,noscript,iframe,form,nav,footer,header,svg')
    .forEach((node) => node.remove());
  const article = new Readability(document.cloneNode(true), {
    charThreshold: 80,
  }).parse();
  let text =
    article?.textContent ||
    document.querySelector('main,article')?.textContent ||
    document.body?.textContent ||
    '';
  text = text
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n\s*\n\s*\n/gu, '\n\n')
    .trim();
  if (text.length < 60)
    return {
      status: 'browser_required',
      title,
      source,
      reason:
        '直接响应没有足够正文，可能依赖浏览器渲染；请换可读来源或使用官方文档 API。',
    };
  return { status: 'ok', title: article?.title || title, source, text };
}

/**
 * 在 NAS 直接读取公开网页，作为搜索提取服务故障后的独立网络路径。
 * @param args - 公开 URL 和正文字符分页位置。
 * @param dependencies - 验证时可替换的 DNS 与实际传输；生产使用固定公网校验和受控下载。
 * @returns 公开正文分页、真实来源或访问限制，不解析其他插件的业务链接。
 * @throws URL 越界、DNS 非公网、超时或响应不支持时停止读取。
 */
export async function readWeb(args, dependencies = {}) {
  let url = new URL(String(args.url || ''));
  const offset = Number(args.offset || 0),
    limit = Number(args.limit || 12000);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 100 ||
    limit > 20000
  )
    throw new Error('offset 必须非负，limit 范围 100 至 20000。');
  const signal = AbortSignal.timeout(20000);
  const resolve = dependencies.lookup || lookup;
  const fetchPage = dependencies.download || download;
  for (let hop = 0; hop <= 4; hop++) {
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error('只支持没有凭据和自定义端口的公开 HTTP/HTTPS 网页。');
    const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    let addresses;
    if (isIP(hostname))
      addresses = [{ address: hostname, family: isIP(hostname) }];
    else {
      addresses = await Promise.race([
        resolve(hostname, { all: true }),
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('网页 DNS 解析超时')),
            { once: true },
          );
        }),
      ]);
    }
    if (
      !addresses.length ||
      addresses.some((item) => !isPublicAddress(item.address))
    )
      throw new Error('拒绝访问内网、回环或保留地址。');
    signal.throwIfAborted();
    const response = await fetchPage(url, addresses, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.location || hop === 4)
        throw new Error('网页重定向无效或超过四次。');
      url = new URL(response.headers.location, url);
      continue;
    }
    if ([401, 403, 429].includes(response.status))
      return {
        status: 'access_required',
        source: url.href,
        httpStatus: response.status,
        reason: '来源要求授权、验证或限流；没有绕过限制。',
      };
    if (response.status !== 200)
      throw new Error(`来源网页返回 HTTP ${response.status}`);
    let body = response.body;
    const options = { maxOutputLength: 3 * 1024 * 1024 };
    if (response.headers['content-encoding'] === 'gzip')
      body = gunzipSync(body, options);
    else if (response.headers['content-encoding'] === 'br')
      body = brotliDecompressSync(body, options);
    else if (response.headers['content-encoding'] === 'deflate')
      body = inflateSync(body, options);
    if (body.length > 3 * 1024 * 1024)
      throw new Error('解压正文超过大小限制。');
    const type = String(response.headers['content-type'] || '');
    if (
      !/text\/(html|plain|markdown)|application\/(json|xhtml\+xml)/iu.test(type)
    )
      return {
        status: 'unsupported_content',
        source: url.href,
        contentType: type,
        reason: '当前读取器只提取网页、文本和 JSON，未读取该文件正文。',
      };
    const charset = /charset=["']?([\w-]+)/iu.exec(type)?.[1] || 'utf-8';
    const raw = new TextDecoder(charset).decode(body);
    let result = { status: 'ok', source: url.href, title: '', text: raw };
    if (/html/iu.test(type)) result = extractPage(raw, url.href);
    if (result.status !== 'ok') return result;
    const total = result.text.length;
    return {
      ...result,
      text: result.text.slice(offset, offset + limit),
      totalCharacters: total,
      offset,
      hasMore: offset + limit < total,
      nextOffset: Math.min(offset + limit, total),
      fetchedAt: new Date().toISOString(),
      backend: 'nas-direct',
    };
  }
  throw new Error('网页未返回可读取正文。');
}
