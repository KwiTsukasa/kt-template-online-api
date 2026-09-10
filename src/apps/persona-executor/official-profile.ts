export type OfficialProfile = {
  name: string;
  avatar: string;
  uin: string;
};

export class OfficialProfileReader {
  private token = '';
  private expiresAt = 0;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  /**
   * 使用 NAS 私有凭据取得官方访问令牌，提前失效缓存且不输出凭据或原始错误。
   * @returns 当前 Bot 的有效访问令牌。
   * @throws 官方认证失败或令牌结构不完整时停止核验。
   */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    const value = await response.json();
    const expiresIn = Number(value.expires_in);
    if (
      !response.ok ||
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 60
    )
      throw new Error('QQ 官方资料认证失败。');
    this.token = value.access_token;
    this.expiresAt = Date.now() + (expiresIn - 60) * 1000;
    return this.token;
  }

  /**
   * 从 QQ Bot OpenAPI 读取实际昵称头像，并将分享链接中的账号绑定到当前 AppID。
   * @returns 与配置 AppID 一致的 QQ 资料及机器人 QQ 号。
   * @throws 认证、身份或资料格式异常时拒绝确认生效。
   */
  async read(): Promise<OfficialProfile> {
    const response = await fetch('https://api.sgroup.qq.com/users/@me', {
      headers: { Authorization: 'QQBot ' + (await this.accessToken()) },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (response.status === 401) {
      this.token = '';
      this.expiresAt = 0;
    }
    const value = await response.json();
    if (
      !response.ok ||
      typeof value.username !== 'string' ||
      typeof value.avatar !== 'string' ||
      typeof value.share_url !== 'string'
    )
      throw new Error('QQ 官方资料读取失败。');
    const share = new URL(value.share_url);
    const uin = share.searchParams.get('robot_uin') || '';
    if (
      share.origin !== 'https://qun.qq.com' ||
      share.searchParams.get('robot_appid') !== this.appId ||
      !/^\d{5,12}$/u.test(uin)
    )
      throw new Error('QQ 官方资料的 Bot 身份不符。');
    return { name: value.username, avatar: value.avatar, uin };
  }
}
