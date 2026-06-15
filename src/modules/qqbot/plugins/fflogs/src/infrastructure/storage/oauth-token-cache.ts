export class FflogsOAuthTokenCache {
  private accessToken = '';
  private accessTokenExpireAt = 0;

  getValidToken(now = Date.now()) {
    return this.accessToken && this.accessTokenExpireAt > now
      ? this.accessToken
      : '';
  }

  setToken(token: string, expiresInSeconds: number, now = Date.now()) {
    this.accessToken = token;
    this.accessTokenExpireAt = now + Math.max(expiresInSeconds - 60, 1) * 1000;
  }
}
