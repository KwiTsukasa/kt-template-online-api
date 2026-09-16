const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile, access } = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

/**
 * 首次写入密封内容，重复请求必须与已有文件逐字节一致。
 * @param file - 工作流状态边界内的文件。
 * @param content - 不可变清单或固定版本源码。
 * @returns 文件写入或同内容校验完成后返回。
 * @throws 同一路径已保存不同内容时拒绝覆盖。
 */
async function immutable(file, content) {
  try {
    await writeFile(file, content, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await readFile(file, 'utf8')) !== content)
      throw new Error('workflow-remote-content-conflict');
  }
}

/**
 * 读取当前工作流尝试的完整 JSON 文件，文件尚未生成时返回空值。
 * @param file - 尝试目录内的回执或心跳文件。
 * @returns 已解析的记录或空值。
 * @throws 文件读取失败或已存在的记录不是合法 JSON 时拒绝返回状态。
 */
async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 处理单次启动、读取或取消请求，只有启动会创建有界脚本包装进程。
 * @param request - 工作流传输的固定尝试身份、受控目录和版本内容。
 * @returns 启动确认、当前回执或取消确认。
 * @throws 身份、源码摘要或清单重放不一致时拒绝执行。
 */
async function control(request) {
  const { operation, executionId, root, nodeBinary } = request;
  if (
    !['start', 'read', 'cancel'].includes(operation) ||
    !/^[a-f0-9]{64}$/.test(executionId) ||
    !path.isAbsolute(root) ||
    path.parse(root).root === root ||
    !path.isAbsolute(nodeBinary)
  )
    throw new Error('workflow-remote-boundary-invalid');
  const directory = path.join(root, executionId);
  if (operation === 'read') {
    const result = await optionalJson(path.join(directory, 'result.json'));
    if (result) return result;
    const heartbeat = await optionalJson(
      path.join(directory, 'heartbeat.json'),
    );
    if (
      heartbeat?.executionId === executionId &&
      Date.now() - Date.parse(heartbeat.observedAt) < 10000
    )
      return { status: 'running', executionId };
    return { status: 'unconfirmed', executionId };
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (operation === 'cancel') {
    await immutable(
      path.join(directory, 'cancel.json'),
      JSON.stringify({ executionId }),
    );
    return { cancelled: true };
  }
  const { manifest, source, wrapper, protocol } = request;
  if (
    manifest?.executionId !== executionId ||
    typeof source !== 'string' ||
    typeof wrapper !== 'string' ||
    typeof protocol !== 'string' ||
    !['node', 'python', 'bash'].includes(manifest.runtime) ||
    !path.isAbsolute(manifest.binary)
  )
    throw new Error('workflow-remote-manifest-invalid');
  if (
    createHash('sha256').update(source).digest('hex') !==
    manifest.script?.sha256
  )
    throw new Error('workflow-remote-script-digest-mismatch');
  const bundleSha = createHash('sha256')
    .update(wrapper)
    .update('\0')
    .update(protocol)
    .digest('hex');
  const bundle = path.join(root, 'runtime', bundleSha);
  const assets = path.join(root, 'assets');
  await mkdir(bundle, { recursive: true, mode: 0o700 });
  await mkdir(assets, { recursive: true, mode: 0o700 });
  let extension = '.mjs';
  if (manifest.runtime === 'python') extension = '.py';
  if (manifest.runtime === 'bash') extension = '.sh';
  const scriptPath = path.join(assets, manifest.script.sha256 + extension);
  await immutable(scriptPath, source);
  await immutable(path.join(bundle, 'run-script.mjs'), wrapper);
  await immutable(path.join(bundle, 'script-protocol.mjs'), protocol);
  const input = { ...manifest, scriptPath };
  const inputFile = path.join(directory, 'input.json');
  try {
    await writeFile(inputFile, JSON.stringify(input), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!isDeepStrictEqual(await optionalJson(inputFile), input))
      throw new Error('workflow-remote-attempt-changed');
  }
  try {
    await access(path.join(directory, 'claimed'));
    return { accepted: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await new Promise((resolve, reject) => {
    const child = spawn(
      nodeBinary,
      [path.join(bundle, 'run-script.mjs'), directory],
      { detached: true, stdio: 'ignore', windowsHide: true, shell: false },
    );
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return { accepted: true };
}

/**
 * 从标准输入读取一次控制请求，输出可核对身份的回执后结束，不开放网络监听端口。
 * @returns 当前请求处理完成后返回。
 * @throws 请求超过两 MiB 或不是合法 JSON 时拒绝处理。
 */
async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const part of process.stdin) {
    raw += part;
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
      throw new Error('workflow-remote-request-too-large');
  }
  const request = JSON.parse(raw);
  const value = await control(request);
  process.stdout.write(
    JSON.stringify({ executionId: request.executionId, value }),
  );
}

main().catch(() => {
  process.stderr.write('workflow-remote-request-failed\n');
  process.exitCode = 1;
});
