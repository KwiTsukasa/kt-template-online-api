import { isIP } from 'node:net';

/**
 * 把 NATMap 当前公网 IPv4 与动态端口编码为官方 IP4P AAAA 文本，非法或不完整端点返回空值。
 * @param publicIpv4 - NATMap 当前发布的规范公网 IPv4。
 * @param publicPort - NATMap 当前发布的动态公网 TCP 端口。
 * @returns `2001::端口:IPv4高两字节:IPv4低两字节` 的零填充文本；端点无效时为 `null`。
 */
export function encodeIp4pAddress(
  publicIpv4?: null | string,
  publicPort?: null | number,
): null | string {
  if (!publicIpv4 || isIP(publicIpv4) !== 4) {
    return null;
  }
  if (
    typeof publicPort !== 'number' ||
    !Number.isInteger(publicPort) ||
    publicPort < 1 ||
    publicPort > 65_535
  ) {
    return null;
  }
  const octets = publicIpv4.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  const portHex = publicPort.toString(16).padStart(4, '0');
  const addressHigh = ((octets[0] << 8) | octets[1])
    .toString(16)
    .padStart(4, '0');
  const addressLow = ((octets[2] << 8) | octets[3])
    .toString(16)
    .padStart(4, '0');
  return `2001::${portHex}:${addressHigh}:${addressLow}`;
}
