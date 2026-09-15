import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProjection, publish, inspect } from '../../../../src/modules/plugins/hermes-agent/assets/runtime/conversation-souls.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const fixture = (revision = 1) => ({ schemaVersion: 1, revision, fallback: hash('原人格'), bindings: { ['a'.repeat(64)]: hash('新人格') }, souls: { [hash('原人格')]: '原人格', [hash('新人格')]: '新人格' } });

test('拒绝非法键、缺失引用和伪造摘要', () => {
  assert.equal(parseProjection(JSON.stringify(fixture())).revision, 1);
  for (const change of [
    { revision: 0 }, { revision: 1.5 }, { bindings: { '../escape': hash('新人格') } },
    { bindings: { ['a'.repeat(64)]: 'b'.repeat(64) } }, { souls: { [hash('原人格')]: '改写' } },
  ]) assert.throws(() => parseProjection(JSON.stringify({ ...fixture(), ...change })));
  assert.throws(() => parseProjection('x'.repeat(49 * 1024)));
});

test('发布清单按会话引用不可变原生SOUL，拒绝旧版本并保留非人格数据', { skip: process.platform === 'win32' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'kt-soul-test-'));
  try {
    const one = publish(home, JSON.stringify(fixture()));
    assert.equal(inspect(home).digest, one.digest);
    const root = join(home, '.kt-conversation-souls');
    assert.equal(readFileSync(join(root, hash('新人格'), 'SOUL.md'), 'utf8'), '新人格');
    assert.equal(statSync(join(root, hash('新人格'), 'SOUL.md')).mode & 0o777, 0o600);
    const two = fixture(2);
    two.bindings['b'.repeat(64)] = hash('原人格');
    publish(home, JSON.stringify(two));
    assert.throws(() => publish(home, JSON.stringify(fixture())), /版本冲突/u);
    const conflict = fixture(2); conflict.bindings['a'.repeat(64)] = hash('原人格');
    assert.throws(() => publish(home, JSON.stringify(conflict)), /版本冲突/u);
    assert.equal(inspect(home).revision, 2);
    const manifest = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'));
    assert.equal(manifest.bindings['a'.repeat(64)], hash('新人格'));
    assert.equal(manifest.bindings['b'.repeat(64)], hash('原人格'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
