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
    expect(verify).toContain('wait_for_absent');
    expect(verify).toContain('/proc/1/cgroup');
    expect(verify).toContain('/proc/1/cmdline');
    expect(verify).toContain('/proc/1/sched');
    expect(verify).toContain('/proc/1/status');
    expect(verify).toContain('/proc/1/stat');
    expect(verify).toContain('/proc/1/mountinfo');
    expect(verify).toContain('/proc/self/mountinfo');
    expect(verify).toContain('/sys/class/dmi/id/product_name');
    expect(verify).toContain('/sys/class/dmi/id/bios_vendor');
    expect(verify).toContain('/sys/class/dmi/id/bios_version');
    expect(verify).toContain('/etc/hosts');
    expect(verify).toContain('XDG_CONFIG_HOME=/app/.config');
    expect(verify).toContain('Asia/Shanghai');
  });

  it('patches entrypoint device profile probes that QQCore opens at runtime', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    const entrypointPatch = readSource(
      'ci/napcat-desktop-cn/entrypoint-device-profile.patch.sh',
    );
    const source = `${dockerfile}\n${entrypointPatch}`;

    expect(source).toContain('entrypoint-device-profile.patch.sh');
    expect(source).toContain('NAPCAT_REQUIRE_DEVICE_PROFILE');
    expect(source).toContain('NAPCAT_DMI_BIOS_VENDOR');
    expect(source).toContain('NAPCAT_DMI_BIOS_VERSION');
    expect(source).toContain('NAPCAT_DMI_MODALIAS');
    expect(source).toContain('NAPCAT_DEVICE_BOOT_ID');
    expect(source).toContain('NAPCAT_DEVICE_KERNEL_RELEASE');
    expect(source).toContain('NAPCAT_DEVICE_CPU_MODEL');
    expect(source).toContain('NAPCAT_DEVICE_UPTIME');
    expect(source).toContain('NAPCAT_DEVICE_TTY_ACTIVE');
    expect(source).toContain('/proc/uptime');
    expect(source).toContain('/proc/cpuinfo');
    expect(source).toContain('/sys/devices/virtual/tty/tty0/active');
    expect(source).toContain('mountinfo-host-leak:/proc/1/mountinfo');
    expect(source).not.toContain('for kt_mountinfo in /proc/self/mountinfo /proc/1/mountinfo');
    expect(source).toContain('mount --bind "$FAKE_CMDLINE" /proc/1/cmdline');
    expect(source).toContain('kt_require_device_profile');
    expect(source).toContain('exit 78');
    expect(source).toContain('dmi-modalias');
    expect(source).toContain('proc-devices-host-leak');
  });

  it('stages source-built NapCat Shell artifacts for Docker build context', () => {
    const script = readSource('scripts/napcat-desktop-cn-stage-build.mjs');

    expect(script).toContain('napcatMjsSha256');
    expect(script).toContain('forkCommit');
    expect(script).toContain('upstreamBaseCommit');
    expect(script).toContain('upstreamReleaseTag');
    expect(script).toContain('upstreamReleaseCommit');
    expect(script).toContain('napcatBaseImageDigest');
    expect(script).toContain('jenkinsBuildUrl');
    expect(script).toContain('packages/napcat-shell/dist');
    expect(script).toContain('fork-artifact.json');
    expect(script).toContain('entrypoint-device-profile.patch.sh');
    expect(script).toContain('.kt-workspace/napcat-desktop-cn-build');
    expect(script).toContain('assertSafeOutputRoot');
    expect(script).toContain('workspaceRoot');
    expect(script).toContain('Output root must stay inside');
    expect(script).toContain('Refusing to delete unsafe output root');
  });

  /**
   * Verifies the checked-in operator guide documents the full release evidence contract.
   */
  it('documents complete release metadata for staging NapCat Shell artifacts', () => {
    const readme = readSource('ci/napcat-desktop-cn/README.md');

    expect(readme).toContain('--upstream-release-tag');
    expect(readme).toContain('--upstream-release-commit');
    expect(readme).toContain('--napcat-base-image-digest');
    expect(readme).toContain('--jenkins-build-url');
    expect(readme).toContain('NapCat.Shell.zip');
    expect(readme).toContain('fork-artifact.json');
    expect(readme).toContain('sha256:');
  });

  it('uses source-built NapCat Shell artifact instead of bundled JS patching', () => {
    const dockerfile = readSource('ci/napcat-desktop-cn/Dockerfile');
    const verify = readSource('ci/napcat-desktop-cn/verify.sh');

    expect(dockerfile).toContain('COPY NapCat.Shell /tmp/NapCat.Shell');
    expect(dockerfile).toContain('fork-artifact.json');
    expect(dockerfile).toContain('zip -qr /app/NapCat.Shell.zip .');
    expect(dockerfile).not.toContain('qq-login-real-online-guard.sh');
    expect(dockerfile).not.toContain('NAPCAT_PATCH_ROOT');
    expect(verify).toContain('napcatMjsSha256');
    expect(verify).toContain('getQQLoginRuntimeState');
    expect(verify).toContain('qrcodeRevision');
    expect(verify).toContain('needsLoginServiceReset');
    expect(verify).not.toContain('selfInfo?.online !== false');
  });

  it('deploys the production API with the verified desktop-cn-v8 runtime profile', () => {
    const manifest = readSource('k8s/prod/api.yaml');

    expect(manifest).toContain('name: QQBOT_NAPCAT_IMAGE');
    expect(manifest).toContain('value: kt-napcat-desktop-cn:desktop-cn-v8');
    expect(manifest).toContain('name: QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION');
    expect(manifest).toContain('value: desktop-cn-v8');
    expect(manifest).not.toContain('kt-napcat-desktop-cn:desktop-cn-v7');
    expect(manifest).not.toContain('kt-napcat-desktop-cn:desktop-cn-v4');
    expect(manifest).not.toContain('kt-napcat-desktop-cn:desktop-cn-v3');
    expect(manifest).not.toContain('kt-napcat-desktop-cn:desktop-cn-v2');
  });
});
