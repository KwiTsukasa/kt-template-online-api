import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Admin token deployment boundary', () => {
  const jenkinsfile = readFileSync(resolve('Jenkinsfile'), 'utf8');

  it('rejects duplicate, short, and known default signing secrets before deployment', () => {
    expect(jenkinsfile).toContain("grep -c '^ADMIN_TOKEN_SECRET='");
    expect(jenkinsfile).toContain('[ "\\${#admin_secret}" -lt 32 ]');
    expect(jenkinsfile).toContain('[ "\\$admin_secret" = \'change-me\' ]');
    expect(jenkinsfile).toContain(
      '[ "\\$admin_secret" = \'kt-template-online-admin-token-secret\' ]',
    );
  });

  it('never prints the signing secret while validating the private env file', () => {
    expect(jenkinsfile).not.toMatch(/echo[^\n]*\$admin_secret/u);
    expect(jenkinsfile).not.toMatch(/printf[^\n]*\$admin_secret/u);
  });
});
