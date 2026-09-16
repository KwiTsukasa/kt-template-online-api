import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = process.env.WORKFLOW_RUNTIME_TEST_ROOT;
if (!root || !path.isAbsolute(root) || !root.includes('.kt-workspace'))
  throw new Error('test artifact root required');
const wrapper = fileURLToPath(
  new URL('../../../scripts/workflow/run-script.mjs', import.meta.url),
);
const prefix = `let text='';for await (const chunk of process.stdin) text+=chunk;const input=JSON.parse(text);const event={protocol:input.protocol,kind:'result',executionId:input.executionId,scriptSha256:input.scriptSha256,sequence:1,status:'succeeded',data:{value:input.params.amount},error:null};`;
const fixture = async (name, source, timeoutMs = 5000) => {
  const executionId = createHash('sha256')
    .update(`${name}:${Date.now()}:${Math.random()}`)
    .digest('hex');
  const directory = path.join(root, executionId);
  await mkdir(directory, { recursive: true });
  const scriptPath = path.join(directory, 'uploaded.mjs');
  await writeFile(scriptPath, source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  await writeFile(
    path.join(directory, 'input.json'),
    JSON.stringify({
      executionId,
      script: { key: 'test.script', version: 1, sha256 },
      scriptPath,
      binary: process.execPath,
      runtime: 'node',
      timeoutMs,
      payload: {
        context: { stepKey: 'test.check' },
        params: { amount: 3 },
        previous: [],
      },
    }),
  );
  return { executionId, directory, scriptPath };
};
const run = async (sample) => {
  await execute(process.execPath, [wrapper, sample.directory], {
    windowsHide: true,
    timeout: 15000,
  });
  return JSON.parse(
    await readFile(path.join(sample.directory, 'result.json'), 'utf8'),
  );
};

test('真实短进程按标准回执完成并退出，业务字段保留在 data 内', async () => {
  const sample = await fixture(
    'success',
    `${prefix}console.log(JSON.stringify(event));`,
  );
  const result = await run(sample);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.deepEqual(result.output, { value: 3 });
});

test('退出码零、普通 JSON 或进度 100 都不等于成功', async () => {
  for (const source of [
    'console.log("a normal log");',
    'console.log(JSON.stringify({success:true}));',
    `${prefix}console.log(JSON.stringify({...event,kind:'progress',progress:{current:100,total:100,message:'进度满了'},status:undefined,error:undefined}));`,
  ]) {
    const result = await run(await fixture('missing-result', source));
    assert.equal(result.status, 'failed');
  }
});

test('覆盖运行身份、额外顶层业务字段和重复终态均失败', async () => {
  for (const output of [
    "console.log(JSON.stringify({...event,executionId:'wrong'}));",
    'console.log(JSON.stringify({...event,quality:1080}));',
    'console.log(JSON.stringify(event));console.log(JSON.stringify({...event,sequence:2}));',
  ]) {
    const result = await run(
      await fixture('invalid-protocol', `${prefix}${output}`),
    );
    assert.equal(result.status, 'failed');
  }
});

test('失败回执与退出码必须一致，合法失败保留错误码', async () => {
  const failed = `${prefix}console.log(JSON.stringify({...event,status:'failed',data:{},error:{code:'MEDIA_INVALID',message:'业务事实不满足条件'}}));`;
  assert.equal(
    (await run(await fixture('wrong-exit', failed))).status,
    'failed',
  );
  const result = await run(
    await fixture('failed', `${failed}process.exitCode=1;`),
  );
  assert.equal(result.error.code, 'MEDIA_INVALID');
  assert.equal(result.exitCode, 1);
});

test('版本摘要变更时脚本根本不会启动', async () => {
  const sample = await fixture(
    'drift',
    `${prefix}console.log(JSON.stringify(event));`,
  );
  await writeFile(sample.scriptPath, 'throw new Error("changed");');
  const result = await run(sample);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /content-changed/);
});

test('并发重放同一尝试只创建一个脚本副作用', async () => {
  const sample = await fixture(
    'replay',
    `import{appendFileSync}from'node:fs';${prefix}appendFileSync('count.txt','1');await new Promise(r=>setTimeout(r,300));console.log(JSON.stringify(event));`,
  );
  await Promise.all([
    execute(process.execPath, [wrapper, sample.directory], {
      windowsHide: true,
      timeout: 10000,
    }),
    execute(process.execPath, [wrapper, sample.directory], {
      windowsHide: true,
      timeout: 10000,
    }),
  ]);
  assert.equal(
    await readFile(path.join(sample.directory, 'count.txt'), 'utf8'),
    '1',
  );
  await run(sample);
  assert.equal(
    await readFile(path.join(sample.directory, 'count.txt'), 'utf8'),
    '1',
  );
});

test('工作流停止意图等待实际脚本退出才形成取消回执', async () => {
  const sample = await fixture(
    'cancel',
    `${prefix}await new Promise(r=>setTimeout(r,20000));console.log(JSON.stringify(event));`,
    25000,
  );
  const running = run(sample);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await writeFile(
    path.join(sample.directory, 'cancel.json'),
    JSON.stringify({ executionId: sample.executionId }),
  );
  assert.equal((await running).status, 'cancelled');
});

test('Bash 脚本通过固定解释器接收标准输入并返回标准业务结果', async () => {
  let binary = process.env.WORKFLOW_BASH_BINARY;
  if (!binary && process.platform !== 'win32') binary = '/bin/bash';
  assert.ok(
    binary && path.isAbsolute(binary),
    'Bash 测试需要明确的解释器绝对路径',
  );
  const source =
    '#!/usr/bin/env bash\nset -euo pipefail\ntest -n "$BASH_VERSION"\n' +
    `node -e 'let raw="";process.stdin.on("data",part=>raw+=part);process.stdin.on("end",()=>{const input=JSON.parse(raw);console.log(JSON.stringify({protocol:input.protocol,kind:"result",executionId:input.executionId,scriptSha256:input.scriptSha256,sequence:1,status:"succeeded",data:{value:input.params.amount*3},error:null}));});'\n`;
  const sample = await fixture('bash', source);
  const scriptPath = path.join(sample.directory, 'script with spaces.sh');
  await writeFile(scriptPath, source);
  const inputPath = path.join(sample.directory, 'input.json');
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'));
  await writeFile(
    inputPath,
    JSON.stringify({ ...manifest, runtime: 'bash', binary, scriptPath }),
  );
  const result = await run(sample);
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.output, { value: 9 });
});
