import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../..');

/**
 * Reads a repo file as UTF-8 text for static runtime promotion contract assertions.
 * @param relativePath - Repository-relative path under `Node/kt-template-online-api`.
 * @returns The file contents as UTF-8 text.
 */
const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('NapCat runtime promotion contract', () => {
  it('exposes Jenkins parameters for runtime image and profile overrides', () => {
    const jenkinsfile = readSource('Jenkinsfile');

    expect(jenkinsfile).toContain("string(name: 'QQBOT_NAPCAT_IMAGE_OVERRIDE'");
    expect(jenkinsfile).toContain(
      "string(name: 'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE'",
    );
    expect(jenkinsfile).toContain(
      'kubectl ${kubeConfigArg} ${namespaceArg} set env',
    );
    expect(jenkinsfile).toContain(
      'QQBOT_NAPCAT_IMAGE=${napcatImageOverride}',
    );
    expect(jenkinsfile).toContain(
      'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION=${napcatProfileOverride}',
    );
  });

  it('keeps a safe default runtime profile in the K8s manifest', () => {
    const manifest = readSource('k8s/prod/api.yaml');

    expect(manifest).toContain('value: kt-napcat-desktop-cn:desktop-cn-v15');
    expect(manifest).toContain('value: desktop-cn-v15');
  });
});
