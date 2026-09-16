import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScriptEvent, scriptInput } from './script-protocol.mjs';

/**
 * 用同目录原子替换保存脚本回执，读取方不会看到半段 JSON。
 * @param file - 工作流独占运行目录内的目标文件。
 * @param value - 可序列化的运行状态。
 * @returns 文件替换完成后返回。
 */
async function save(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}

/**
 * 停止本包装进程亲自创建且仍未退出的子进程树，禁止按历史 PID 清理未知进程。
 * @param child - 当前包装进程拥有的活动子进程。
 * @param force - 宽限期结束后是否强制结束。
 */
function stopChild(child, force) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform === 'win32') {
    const args = ['/PID', String(child.pid), '/T'];
    if (force) args.push('/F');
    execFile('taskkill.exe', args, { windowsHide: true }, () => {});
    return;
  }
  let signal = 'SIGTERM';
  if (force) signal = 'SIGKILL';
  try {
    process.kill(-child.pid, signal);
  } catch {
    /* 子进程可能已经退出。 */
  }
}

/**
 * 为唯一脚本尝试建立独占运行标记，执行一次并落盘真实退出回执；进程结束后没有常驻监听服务。
 * @param directory - 工作流生成的唯一脚本尝试目录。
 * @returns 本次脚本与回执写入结束后返回。
 * @throws 输入清单或文件摘要不匹配时拒绝启动脚本。
 */
export async function runScript(directory) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(
    await readFile(path.join(root, 'input.json'), 'utf8'),
  );
  if (
    !/^[a-f0-9]{64}$/.test(manifest.executionId) ||
    path.basename(root) !== manifest.executionId ||
    !['bash', 'node', 'python'].includes(manifest.runtime) ||
    !path.isAbsolute(manifest.scriptPath) ||
    !path.isAbsolute(manifest.binary)
  )
    throw new Error('workflow-script-manifest-invalid');
  if (
    !Number.isSafeInteger(manifest.timeoutMs) ||
    manifest.timeoutMs < 1000 ||
    manifest.timeoutMs > 24 * 86400000
  )
    throw new Error('workflow-script-timeout-invalid');
  try {
    await mkdir(path.join(root, 'claimed'), { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') return;
    throw error;
  }
  const startedAt = new Date().toISOString();
  const base = {
    executionId: manifest.executionId,
    script: manifest.script,
    startedAt,
  };
  const resultPath = path.join(root, 'result.json');
  const heartbeatPath = path.join(root, 'heartbeat.json');
  let child;
  let heartbeat;
  let forceTimer;
  let timeout;
  let output = '';
  let stderr = '';
  let stopReason = null;
  let polling = false;
  let terminal = null;
  let sequence = 0;
  let protocolError = null;
  let progressWrites = Promise.resolve();
  const consumeLine = (line) => {
    if (!line.trim()) return;
    try {
      if (terminal) throw new Error('workflow-script-output-after-result');
      const event = parseScriptEvent(JSON.parse(line), {
        executionId: manifest.executionId,
        scriptSha256: manifest.script.sha256,
        sequence,
      });
      sequence = event.sequence;
      if (event.kind === 'result') terminal = event;
      else
        progressWrites = progressWrites
          .then(() => save(path.join(root, 'progress.json'), event))
          .catch(() => requestStop('state-write-failed'));
    } catch (error) {
      protocolError = String(error);
      requestStop('protocol-invalid');
    }
  };
  const requestStop = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    if (child) stopChild(child, false);
    forceTimer = setTimeout(() => {
      if (child) stopChild(child, true);
    }, 5000);
  };
  const signalStop = () => requestStop('cancelled');
  process.on('SIGTERM', signalStop);
  process.on('SIGINT', signalStop);
  try {
    const scriptStat = await stat(manifest.scriptPath);
    if (!scriptStat.isFile()) throw new Error('workflow-script-file-invalid');
    const digest = createHash('sha256')
      .update(await readFile(manifest.scriptPath))
      .digest('hex');
    if (digest !== manifest.script.sha256)
      throw new Error('workflow-script-content-changed');
    await save(heartbeatPath, {
      ...base,
      observedAt: new Date().toISOString(),
      pid: process.pid,
    });
    try {
      const cancel = JSON.parse(
        await readFile(path.join(root, 'cancel.json'), 'utf8'),
      );
      if (cancel.executionId === manifest.executionId) {
        await save(resultPath, {
          ...base,
          status: 'cancelled',
          exitCode: null,
          output: {},
          finishedAt: new Date().toISOString(),
        });
        return;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let scriptArguments = [manifest.scriptPath];
    if (manifest.runtime === 'bash')
      scriptArguments = ['--noprofile', '--norc', manifest.scriptPath];
    const scriptEnvironment = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (
        /^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_[A-Z_]+|TZ)$/i.test(
          key,
        )
      )
        scriptEnvironment[key] = value;
    }
    delete scriptEnvironment.BASH_ENV;
    delete scriptEnvironment.ENV;
    child = spawn(manifest.binary, scriptArguments, {
      cwd: root,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: scriptEnvironment,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > 1024 * 1024)
        requestStop('output-limit');
      else {
        output += chunk;
        let newline = output.indexOf('\n');
        while (newline !== -1) {
          consumeLine(output.slice(0, newline));
          output = output.slice(newline + 1);
          newline = output.indexOf('\n');
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr) < 64 * 1024) stderr += chunk;
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(scriptInput(manifest)));
    heartbeat = setInterval(() => {
      if (polling) return;
      polling = true;
      void (async () => {
        await save(heartbeatPath, {
          ...base,
          observedAt: new Date().toISOString(),
          pid: process.pid,
        });
        try {
          const cancel = JSON.parse(
            await readFile(path.join(root, 'cancel.json'), 'utf8'),
          );
          if (cancel.executionId === manifest.executionId)
            requestStop('cancelled');
        } catch (error) {
          if (error.code !== 'ENOENT') requestStop('control-invalid');
        }
      })()
        .catch(() => requestStop('state-write-failed'))
        .finally(() => {
          polling = false;
        });
    }, 1000);
    timeout = setTimeout(() => requestStop('timeout'), manifest.timeoutMs);
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (output.trim()) consumeLine(output);
    let result = {};
    let status = 'failed';
    if (stopReason === 'cancelled') status = 'cancelled';
    else if (!protocolError && terminal && stopReason === null) {
      if (
        (terminal.status === 'succeeded' && exitCode !== 0) ||
        (terminal.status === 'failed' && exitCode === 0)
      )
        throw new Error('workflow-script-exit-status-mismatch');
      result = terminal.data;
      status = terminal.status;
    }
    let error = null;
    if (status !== 'succeeded')
      error =
        terminal?.error ||
        protocolError ||
        stopReason ||
        'workflow-script-result-required';
    await progressWrites;
    await save(resultPath, {
      ...base,
      status,
      exitCode,
      output: result,
      error,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) {
      stopChild(child, true);
      await new Promise((resolve) => child.once('close', resolve));
    }
    await save(resultPath, {
      ...base,
      status: 'failed',
      exitCode: null,
      output: {},
      finishedAt: new Date().toISOString(),
      error: String(error).slice(0, 500),
    });
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    clearTimeout(forceTimer);
    process.off('SIGTERM', signalStop);
    process.off('SIGINT', signalStop);
    await writeFile(path.join(root, 'stderr.log'), stderr.slice(0, 65536), {
      mode: 0o600,
    });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runScript(process.argv[2]).catch(() => {
    process.exitCode = 1;
  });
}
