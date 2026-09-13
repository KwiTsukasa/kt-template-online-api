import { readFileSync } from 'node:fs';

describe('Bot queue storage durability', () => {
  it('keeps the queue on one persistent volume with acknowledged AOF writes and no eviction', () => {
    const documents = readFileSync('k8s/prod/api.yaml', 'utf8').split(
      /^---\s*$/mu,
    );
    const deployment = documents.find(
      (item) =>
        /kind: Deployment\s/u.test(item) &&
        /name: kt-plugin-redis\s/u.test(item),
    );
    const claim = documents.find(
      (item) =>
        /kind: PersistentVolumeClaim\s/u.test(item) &&
        /name: kt-plugin-redis-data\s/u.test(item),
    );
    expect(claim).toMatch(/accessModes:\s+- ReadWriteOnce/u);
    expect(deployment).toMatch(/strategy:\s+type: Recreate/u);
    expect(deployment).toMatch(
      /persistentVolumeClaim:\s+claimName: kt-plugin-redis-data/u,
    );
    expect(deployment).not.toContain('emptyDir');
    expect(deployment).toMatch(/- --appendonly\s+- ['"]yes['"]/u);
    expect(deployment).toMatch(/- --appendfsync\s+- always/u);
    expect(deployment).toMatch(/- --maxmemory-policy\s+- noeviction/u);
  });
});
