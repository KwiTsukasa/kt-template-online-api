import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../..');

/**
 * Reads a repo file as UTF-8 text for static image asset assertions.
 * @param relativePath - Repository-relative path under `Node/kt-template-online-api`.
 */
const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('NapCat Chinese Desktop Runtime image assets', () => {
  it('builds from an explicitly supplied pinned base image', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    expect(dockerfile).toContain('ARG NAPCAT_BASE_IMAGE=');
    expect(dockerfile).toContain('FROM ${NAPCAT_BASE_IMAGE}');
    expect(dockerfile).not.toContain('mlikiowa/napcat-docker:latest');
  });

  it('installs Chinese locale, fonts, timezone, DBus, and fontconfig cache', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    expect(dockerfile).toContain('zh_CN.UTF-8 UTF-8');
    expect(dockerfile).toContain('LANG=zh_CN.UTF-8');
    expect(dockerfile).toContain('LC_ALL=zh_CN.UTF-8');
    expect(dockerfile).toContain('Asia/Shanghai');
    expect(dockerfile).toMatch(/fonts-noto-cjk|fonts-wqy-microhei/);
    expect(dockerfile).toContain('fontconfig');
    expect(dockerfile).toContain('fc-cache -fv');
    expect(dockerfile).toContain('dbus-x11');
    expect(dockerfile).toContain('unzip');
    expect(dockerfile).toContain('zip');
  });

  it('verifies locale, fontconfig, XDG, process user, and container hiding evidence', () => {
    const verify = readSource('ci/napcat-desktop-cn/verify.sh');
    expect(verify).toContain('locale -a');
    expect(verify).toContain('zh_CN.utf8');
    expect(verify).toContain('fc-match');
    expect(verify).toContain('/.dockerenv');
    expect(verify).toContain('/proc/1/cgroup');
    expect(verify).toContain('XDG_CONFIG_HOME=/app/.config');
    expect(verify).toContain('Asia/Shanghai');
    expect(verify).toContain('selfInfo?.online !== false');
    expect(verify).toContain('setQQLoginStatus(false)');
  });

  it('patches NapCat WebUI login guards to allow qrcode refresh after real QQ offline', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    expect(dockerfile).toContain(
      'ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh',
    );
    expect(dockerfile).toContain(
      'sh /tmp/qq-login-real-online-guard.sh',
    );
    expect(dockerfile).toContain(
      "sed -i 's/\\r$//' /tmp/qq-login-real-online-guard.sh",
    );
    expect(dockerfile).toContain('NAPCAT_PATCH_ROOT=/tmp/NapCat.Shell');
    expect(dockerfile).toContain('zip -qr /app/NapCat.Shell.zip .');
    expect(dockerfile).toContain(
      'COPY ci/napcat-desktop-cn/verify.sh /ci/napcat-desktop-cn/verify.sh',
    );
    expect(dockerfile).toContain(
      "sed -i 's/\\r$//' /ci/napcat-desktop-cn/verify.sh",
    );

    const patch = readSource(
      'ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh',
    );
    expect(patch).toContain('QQ Is Logined');
    expect(patch).toContain('getQQLoginStatus');
    expect(patch).toContain('selfInfo?.online');
    expect(patch).toContain('setQQLoginStatus(false)');
    expect(patch).toContain('RefreshQRcode');
    expect(patch).toContain('[A-Za-z_\\$]');
    expect(patch).toContain('[\\w\\$]');
  });
});
