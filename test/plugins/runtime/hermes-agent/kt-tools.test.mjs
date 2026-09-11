import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callCommand,
  handle,
  readDocument,
  search,
} from '../../../../src/modules/plugins/hermes-agent/assets/kt-tools.mjs';

const index = {
  version: 1,
  sources: { KT: 'committed-revision' },
  documents: [
    {
      path: 'docs/operations/hermes.md',
      sha256: 'digest',
      text: '# Hermes 人格\n共享记忆，通过 API 持久化选择。\n第三行',
    },
  ],
};
test('Chinese and English search returns source version and real line positions', () => {
  assert.equal(
    search(index, '人格记忆').results[0].path,
    'docs/operations/hermes.md',
  );
  assert.equal(search(index, 'Hermes').results[0].startLine, 1);
  assert.equal(search(index, 'unrelated').results.length, 0);
  assert.equal(search(index, 'Hermes').sources.KT, 'committed-revision');
});
test('reading uses exact indexed paths and bounded line ranges', () => {
  assert.equal(
    readDocument(index, {
      path: 'docs/operations/hermes.md',
      startLine: 2,
      lineCount: 1,
    }).text,
    '共享记忆，通过 API 持久化选择。',
  );
  assert.throws(() => readDocument(index, { path: '../../.env' }));
  assert.throws(() =>
    readDocument(index, { path: 'docs/operations/hermes.md', lineCount: 999 }),
  );
});
test('model arguments cannot supply missing execution metadata', async () => {
  await assert.rejects(
    callCommand(
      'kt_command_run',
      { contextId: 'forged', _meta: { 'kt/context-id': 'forged' } },
      {},
    ),
    /没有 QQ/,
  );
});
test('MCP exposes bounded command, history, mention, reminder and official API tools', async () => {
  const tools = (await handle({ id: 1, method: 'tools/list' }, index)).result
    .tools;
  assert.equal(tools.length, 8);
  const reminder = tools.find((item) => item.name === 'kt_reminder');
  assert.equal(reminder.inputSchema.properties.platformId.type, 'string');
  assert.equal(reminder.inputSchema.properties.platformId.minLength, undefined);
  assert.match(reminder.inputSchema.properties.platformId.description, /空字符串/u);
  assert.equal(reminder.inputSchema.required.includes('platformId'), false);
  assert.match(reminder.description, /到点真实@/u);
  assert.deepEqual(
    tools.find((item) => item.name === 'qqbot_platform_api').inputSchema
      .properties.method.enum,
    ['GET'],
  );
  const result = await handle(
    {
      id: 2,
      method: 'tools/call',
      params: { name: 'kt_command_run', arguments: {} },
    },
    index,
  );
  assert.equal(result.result.isError, true);
  assert.equal(
    await handle({ method: 'notifications/initialized' }, index),
    null,
  );
});
