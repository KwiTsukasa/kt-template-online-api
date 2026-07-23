import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Reads one repository deployment artifact as UTF-8 text.
 * @param relativePath - Path relative to the API repository root.
 * @returns Deployment artifact contents.
 */
function readDeploymentFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('Network management production deployment contract', () => {
  it('blocks Jenkins deployment when any Network Agent runtime key is absent', () => {
    const jenkinsfile = readDeploymentFile('Jenkinsfile');
    const requiredKeys = [
      'NETWORK_AGENT_ID',
      'NETWORK_AGENT_TARGET_IPV4',
      'NETWORK_AGENT_MQTT_URL',
      'NETWORK_AGENT_MQTT_CLIENT_ID',
      'NETWORK_AGENT_MQTT_USERNAME',
      'NETWORK_AGENT_MQTT_PASSWORD',
      'NETWORK_AGENT_MQTT_RETRY_MS',
    ];

    for (const key of requiredKeys) {
      expect(jenkinsfile).toMatch(
        new RegExp(`requiredRuntimeEnvKeys\\(\\)[\\s\\S]*?['\"]${key}['\"]`),
      );
    }
  });

  it('injects the private runtime Secret through the existing K8s env contract', () => {
    const manifest = readDeploymentFile('k8s/prod/api.yaml');

    expect(manifest).toMatch(
      /envFrom:[\s\S]*?secretRef:[\s\S]*?name:\s*kt-template-online-api-env/,
    );
    expect(manifest).not.toContain('NETWORK_AGENT_MQTT_PASSWORD:');
  });

  it('documents optional DDNS placeholders without promoting them to the Jenkins required gate', () => {
    const envExample = readDeploymentFile('.env.example');
    const jenkinsfile = readDeploymentFile('Jenkinsfile');
    const requiredRuntimeBlock = jenkinsfile.match(
      /def requiredRuntimeEnvKeys\(\) \{[\s\S]*?return \[([\s\S]*?)\]\s*\}/,
    )?.[1];
    const optionalKeys = [
      'NETWORK_DDNS_DNSPOD_ENABLED',
      'NETWORK_DDNS_DNSPOD_SECRET_ID',
      'NETWORK_DDNS_DNSPOD_SECRET_KEY',
      'NETWORK_DDNS_RECONCILE_INTERVAL_MS',
      'NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS',
    ];

    expect(requiredRuntimeBlock).toBeDefined();
    for (const key of optionalKeys) {
      expect(envExample).toMatch(new RegExp(`^${key}=.*$`, 'm'));
      expect(requiredRuntimeBlock).not.toContain(key);
    }

    expect(envExample).toMatch(/^NETWORK_DDNS_DNSPOD_SECRET_ID=$/m);
    expect(envExample).toMatch(/^NETWORK_DDNS_DNSPOD_SECRET_KEY=$/m);
  });
});
