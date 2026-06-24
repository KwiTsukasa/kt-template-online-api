import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../..');

/**
 * 读取仓库根目录下的部署配置文件。
 * @param relativePath - 仓库根目录相对路径。
 * @returns 文件文本内容。
 */
function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

/**
 * 确认仓库根目录下的部署配置文件存在。
 * @param relativePath - 仓库根目录相对路径。
 * @returns 绝对文件路径。
 */
function expectRepoFile(relativePath: string): string {
  const filePath = resolve(REPO_ROOT, relativePath);
  expect(existsSync(filePath)).toBe(true);
  return filePath;
}

describe('NapCat WebUI Gateway deployment configuration', () => {
  it('packages the standalone gateway app in a dedicated runtime image', () => {
    expectRepoFile('dockerfile.gateway');

    const dockerfile = readRepoFile('dockerfile.gateway');

    expect(dockerfile).toContain('dist/apps/napcat-webui-gateway/main');
    expect(dockerfile).toContain('EXPOSE 48086');
    expect(dockerfile).toContain('LOG_APP_NAME=kt-napcat-webui-gateway');
  });

  it('uses reachable Debian mirrors with apt retries in runtime images', () => {
    const runtimeDockerfiles = ['dockerfile', 'dockerfile.gateway'].map(
      readRepoFile,
    );

    for (const dockerfile of runtimeDockerfiles) {
      expect(dockerfile).toContain('mirrors.aliyun.com/debian');
      expect(dockerfile).toContain('mirrors.aliyun.com/debian-security');
      expect(dockerfile).toContain('Acquire::Retries=5');
      expect(dockerfile).toContain(
        'npm_config_index_binary_host_mirror=https://registry.npmmirror.com/-/binary/skia-canvas/',
      );
    }
  });

  it('declares gateway API linkage and cluster runtime without literal secrets', () => {
    const manifest = readRepoFile('k8s/prod/api.yaml');

    expect(manifest).toContain('kt-napcat-webui-gateway');
    expect(manifest).toContain('containerPort: 48086');
    expect(manifest).toContain('type: NodePort');
    expect(manifest).toContain('nodePort: 30086');
    expect(manifest).toContain('NAPCAT_WEBUI_GATEWAY_REDIS_HOST');
    expect(manifest).toContain('NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET');
    expect(manifest).toContain('NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL');
    expect(manifest).toContain('NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL');
    expect(manifest).toMatch(
      /name:\s*NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET[\s\S]*?valueFrom:[\s\S]*?secretKeyRef:/,
    );
    expect(manifest).not.toMatch(
      /name:\s*NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET[\s\S]*?value:\s*["']?[^"'\s]+/,
    );
  });

  it('builds, pushes and rolls out the gateway image through Jenkins', () => {
    const jenkinsfile = readRepoFile('Jenkinsfile');

    expect(jenkinsfile).toContain('GATEWAY_IMAGE_NAME');
    expect(jenkinsfile).toContain('dockerfile.gateway');
    expect(jenkinsfile).toContain('kt-napcat-webui-gateway');
    expect(jenkinsfile).toContain('GATEWAY_DOCKER_IMAGE');
    expect(jenkinsfile).toMatch(/docker push \$\{env\.GATEWAY_DOCKER_IMAGE\}/);
    expect(jenkinsfile).toMatch(
      /rollout status [\s\S]*deployment\/kt-napcat-webui-gateway/,
    );
  });
});
