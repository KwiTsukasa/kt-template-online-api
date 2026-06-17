export class FflogsOAuthTokenCache {
  private accessToken = '';
  private accessTokenExpireAt = 0;

  /**
   * 查询 FFLogs 插件数据。
   * @param now - now 输入；限定 FFLogs查询范围。
   */
  getValidToken(now = Date.now()) {
    return this.accessToken && this.accessTokenExpireAt > now
      ? this.accessToken
      : '';
  }

  /**
   * 设置Token。
   * @param token - 协议 token；写入 FFLogs状态。
   * @param expiresInSeconds - FFLogs列表；驱动 `Math.max()` 的 FFLogs步骤。
   * @param now - now 输入；写入 FFLogs状态。
   */
  setToken(token: string, expiresInSeconds: number, now = Date.now()) {
    this.accessToken = token;
    this.accessTokenExpireAt = now + Math.max(expiresInSeconds - 60, 1) * 1000;
  }
}
