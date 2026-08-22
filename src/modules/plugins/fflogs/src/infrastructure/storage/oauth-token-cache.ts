export class FflogsOAuthTokenCache {
  private accessToken = '';
  private accessTokenExpireAt = 0;

  /**
   * 按`now`读取Valid令牌；当 `this.accessToken && this.accessTokenExpireAt > now` 成立时返回 `this.accessToken`。
   * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `Date.now()`。
   * @returns 当前状态对应的Valid令牌，取值为 `''`。
   */
  getValidToken(now = Date.now()) {
    if (this.accessToken && this.accessTokenExpireAt > now) {
      return this.accessToken;
    }
    return '';
  }

  /**
   * 通过 `Math.max` 收敛数值边界，同时更新 `this.accessToken`、`this.accessTokenExpireAt` 状态。
   * @param token - 决定令牌内容、边界或目标的 `token` 值。
   * @param expiresInSeconds - 决定令牌内容、边界或目标的 `expiresInSeconds` 值。
   * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `Date.now()`。
   */
  setToken(token: string, expiresInSeconds: number, now = Date.now()) {
    this.accessToken = token;
    this.accessTokenExpireAt = now + Math.max(expiresInSeconds - 60, 1) * 1000;
  }
}
