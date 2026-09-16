import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.WORKFLOW_RUNTIME_TEST_ROOT;
if (!root || !path.isAbsolute(root) || !root.includes('.kt-workspace'))
  throw new Error('test artifact root required');
const directory = fileURLToPath(
  new URL('../../../scripts/workflow/', import.meta.url),
);
const wrapper = await readFile(path.join(directory, 'run-script.mjs'), 'utf8');
const protocol = await readFile(
  path.join(directory, 'script-protocol.mjs'),
  'utf8',
);
const source = `import { appendFileSync } from 'node:fs';let raw='';process.stdin.setEncoding('utf8');for await(const part of process.stdin) raw+=part;const input=JSON.parse(raw);appendFileSync('count.txt','1');await new Promise(resolve=>setTimeout(resolve,input.params.delay));console.log(JSON.stringify({protocol:input.protocol,kind:'result',executionId:input.executionId,scriptSha256:input.scriptSha256,sequence:1,status:'succeeded',data:{value:'中文结果',secretInherited:Boolean(process.env.WORKFLOW_TEST_SECRET)},error:null}));`;
const fixture = async (delay = 50) => {
  const executionId = createHash('sha256').update(randomUUID()).digest('hex');
  await mkdir(root, { recursive: true });
  return {
    operation: 'start',
    executionId,
    root,
    nodeBinary: process.execPath,
    source,
    wrapper,
    protocol,
    manifest: {
      executionId,
      script: {
        key: 'test.remote',
        version: 1,
        sha256: createHash('sha256').update(source).digest('hex'),
      },
      runtime: 'node',
      binary: process.execPath,
      timeoutMs: 4000,
      payload: {
        params: { delay },
        context: { stepKey: 'test.remote' },
        previous: [],
      },
    },
  };
};
const request = async (value) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(directory, 'remote-control.cjs')],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, WORKFLOW_TEST_SECRET: 'must-not-reach-script' },
      },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('control request timeout'));
    }, 10000);
    let raw = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part) => {
      raw += part;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('remote rejected'));
        return;
      }
      try {
        const response = JSON.parse(raw);
        assert.equal(response.executionId, value.executionId);
        resolve(response.value);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(value));
  });
const wait = async (sample) => {
  for (let count = 0; count < 80; count += 1) {
    const result = await request({ ...sample, operation: 'read' });
    if (!['running', 'unconfirmed'].includes(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('receipt timeout');
};

test('一次性远端控制协议启动真实子进程并读取标准中文结果，过滤 API 环境密钥', async () => {
  const sample = await fixture();
  assert.deepEqual(await request(sample), { accepted: true });
  const result = await wait(sample);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    value: '中文结果',
    secretInherited: false,
  });
});

test('并发传输同一尝试仅执行一次，字段排序变化不构成新请求', async () => {
  const sample = await fixture(500);
  await Promise.all([request(sample), request(sample)]);
  await wait(sample);
  const reordered = structuredClone(sample);
  reordered.manifest.payload = {
    previous: [],
    context: { stepKey: 'test.remote' },
    params: { delay: 500 },
  };
  await request(reordered);
  assert.equal(
    await readFile(path.join(root, sample.executionId, 'count.txt'), 'utf8'),
    '1',
  );
  reordered.manifest.payload.params.delay = 20;
  await assert.rejects(request(reordered), /remote rejected/);
});

test('提前取消不启动业务脚本，运行中取消等待真实退出', async () => {
  const early = await fixture();
  await request({ ...early, operation: 'cancel' });
  await request(early);
  assert.equal((await wait(early)).status, 'cancelled');
  await assert.rejects(
    readFile(path.join(root, early.executionId, 'count.txt')),
  );
  const active = await fixture(3000);
  await request(active);
  for (let count = 0; count < 30; count += 1) {
    try {
      await readFile(path.join(root, active.executionId, 'count.txt'));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await request({ ...active, operation: 'cancel' });
  assert.equal((await wait(active)).status, 'cancelled');
});

test('篡改源码摘要或尝试路径时拒绝启动', async () => {
  const sample = await fixture();
  await assert.rejects(
    request({ ...sample, source: sample.source + '\nchanged' }),
    /remote rejected/,
  );
  await assert.rejects(
    request({ ...sample, executionId: '../escape' }),
    /remote rejected/,
  );
});
