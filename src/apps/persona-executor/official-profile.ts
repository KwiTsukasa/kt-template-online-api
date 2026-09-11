import { isOfficialBotSelfId } from '../../modules/plugins/persona-switch/src/profile-client';

export type OfficialProfile = { name: string; avatar: string; uin: string };

export class OfficialProfileReader {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly token: string,
  ) {}

  /**
   * 通过 NAS API 中对应账号的官方 SDK 读回资料，执行器不保存 AppSecret 或缓存跨账号令牌。
   * @param selfId - 原始任务持久化的官方 Bot 身份。
   * @returns 与目标账号一致的实际昵称、头像及机器人 QQ 号。
   * @throws 服务地址、身份或官方读回结果不匹配时停止核验。
   */
  async read(selfId: string): Promise<OfficialProfile> {
    if (!isOfficialBotSelfId(selfId))
      throw new Error('QQ 官方资料的 Bot 身份不符。');
    const base = new URL(this.apiBaseUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw new Error('NAS API 地址无效。');
    if (base.pathname !== '/' || base.search || base.hash)
      throw new Error('NAS API 地址无效。');
    const response = await fetch(
      new URL('/bot-adapter/tencent/profile/read', base),
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selfId }),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error('QQ 官方资料读取失败。');
    const value = await response.json();
    if (
      value.selfId !== selfId ||
      value.appId !== selfId.slice('qq-official:'.length)
    )
      throw new Error('QQ 官方资料的 Bot 身份不符。');
    if (
      typeof value.name !== 'string' ||
      typeof value.avatar !== 'string' ||
      typeof value.uin !== 'string' ||
      !/^\d{5,12}$/u.test(value.uin)
    )
      throw new Error('QQ 官方资料的 Bot 身份不符。');
    return { name: value.name, avatar: value.avatar, uin: value.uin };
  }
}
