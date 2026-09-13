import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPlan } from '../../../../src/modules/plugins/hermes-agent/assets/kt-plan-check.mjs';

test('rejects multiplayer evidence for solo mode and unobserved inventory items', () => {
  const result = checkPlan({
    scope: { game: '碧蓝幻想', mode: 'solo' },
    requiredCount: 3,
    inventory: [
      {
        name: '已有武器',
        basis: 'image',
        reference: 'message-1/image-0',
        confirmed: true,
      },
    ],
    sources: [
      {
        id: 'guide',
        reference: 'https://example.com/guide',
        scope: { game: '碧蓝幻想', mode: '多人' },
      },
    ],
    plans: [
      { name: '候选', items: ['已有武器', '未持有武器'], sourceIds: ['guide'] },
    ],
  });
  assert.equal(result.consistent, false);
  assert.deepEqual(
    result.results[0].issues.map((row) => row.code),
    [
      'not_in_observed_inventory',
      'inventory_identification_unconfirmed',
      'configuration_count_mismatch',
      'source_scope_mismatch',
    ],
  );
});

test('keeps unknown region and uncertain image recognition unresolved', () => {
  const input = {
    scope: { game: 'FF14', region: '国服', stage: '第一盘' },
    inventory: [
      {
        name: '16号螳螂',
        basis: 'image',
        reference: 'message-2/image-0',
        confirmed: false,
      },
    ],
    sources: [
      {
        id: 'guide',
        reference: 'https://example.com/guide',
        scope: { game: 'FF14', stage: '第一盘' },
      },
    ],
    plans: [{ name: '候选', items: ['16号螳螂'], sourceIds: ['guide'] }],
  };
  const checked = checkPlan(input);
  assert.equal(checked.consistent, false);
  assert.equal(checked.results[0].issues[1].dimension, 'region');
  input.sources[0].scope.region = '国服';
  input.inventory[0].confirmed = true;
  assert.equal(checkPlan(input).consistent, true);
});
