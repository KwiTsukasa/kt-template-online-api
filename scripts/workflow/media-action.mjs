import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 安装准备程序将这三项替换为固定摘要，生成的标准脚本再上传为不可变版本。
const releaseId = '__KT_MEDIA_RELEASE_SHA256__';
const manifestSha256 = '__KT_MEDIA_MANIFEST_SHA256__';
const configSha256 = '__KT_MEDIA_CONFIG_SHA256__';
const serviceRoot = '/vol1/docker/kt-media-governance/executor';

/**
 * 读取受限普通文件并拒绝符号链接、空内容及过大数据。
 * @param file - 固定发布或证据边界内的文件。
 * @param maxBytes - 本次允许读取的最大字节数。
 * @returns 已检查边界的原始字节。
 * @throws 文件不是受限普通文件时拒绝读取。
 */
function boundedFile(file, maxBytes) {
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > maxBytes
  )
    throw new Error('MEDIA_FILE_BOUNDARY_INVALID');
  if (realpathSync(file) !== path.resolve(file))
    throw new Error('MEDIA_FILE_PATH_CHANGED');
  return readFileSync(file);
}

/**
 * 对实际字节计算摘要，供固定发布、配置和回执证据逐项比较。
 * @param bytes - 当前读取到的文件字节。
 * @returns 小写 SHA-256 摘要。
 */
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 验证固定发布目录的清单身份及每个文件，脚本不能使用被替换的共享媒体库。
 * @returns 本次允许导入的固定发布绝对路径。
 * @throws 发布摘要、清单路径或任一实际文件摘要不一致时拒绝执行。
 */
function releaseRoot() {
  if (
    ![releaseId, manifestSha256, configSha256].every((value) =>
      /^[a-f0-9]{64}$/.test(value),
    )
  )
    throw new Error('MEDIA_RELEASE_NOT_PINNED');
  const root = path.join(serviceRoot, 'releases', releaseId);
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
    throw new Error('MEDIA_RELEASE_BOUNDARY_INVALID');
  const manifest = boundedFile(
    path.join(root, 'release-files.sha256'),
    256 * 1024,
  );
  if (digest(manifest) !== manifestSha256)
    throw new Error('MEDIA_RELEASE_MANIFEST_CHANGED');
  for (const line of manifest.toString('utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64})  \.\/([A-Za-z0-9._/-]+)$/.exec(line);
    if (
      !match ||
      match[2].split('/').some((part) => !part || part === '..' || part === '.')
    )
      throw new Error('MEDIA_RELEASE_MANIFEST_INVALID');
    const file = path.join(root, match[2]);
    if (digest(boundedFile(file, 8 * 1024 * 1024)) !== match[1])
      throw new Error('MEDIA_RELEASE_FILE_CHANGED');
  }
  return root;
}

/**
 * 从工作流标准输入读取一次尝试，限制大小并核对媒体步骤与业务身份。
 * @returns 工作流包装进程提供的固定输入。
 * @throws 标准协议、步骤或身份不满足媒体合同则拒绝启动。
 */
async function readInput() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('MEDIA_WORKFLOW_INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (
    input.protocol !== 'kt.workflow.script.v1' ||
    !/^[a-f0-9]{64}$/.test(input.executionId) ||
    !/^[a-f0-9]{64}$/.test(input.scriptSha256) ||
    input.context?.business?.subjectId !== input.params?.taskId ||
    !/^workflow:[A-Za-z0-9:._-]{1,150}$/.test(input.context?.executionKey ?? '')
  )
    throw new Error('MEDIA_WORKFLOW_IDENTITY_INVALID');
  return input;
}

/**
 * 建立本次步骤的私有证据目录，同一运行身份只能复用完全相同的密封信封。
 * @param envelope - 已经由固定版本合同核验的媒体步骤信封。
 * @returns 供一次性媒体动作使用的私有状态根目录。
 * @throws 目录经过链接、权限不私有或已有信封身份变化时拒绝执行。
 */
function prepareState(envelope) {
  const stateRoot = path.join(serviceRoot, 'state');
  const runRoot = path.join(stateRoot, envelope.runId);
  if (path.dirname(runRoot) !== stateRoot)
    throw new Error('MEDIA_STATE_BOUNDARY_INVALID');
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  for (const directory of [stateRoot, runRoot]) {
    const stat = lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(directory) !== directory ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error('MEDIA_STATE_BOUNDARY_INVALID');
  }
  const envelopeFile = path.join(runRoot, 'envelope.json');
  const bytes = Buffer.from(JSON.stringify(envelope));
  try {
    writeFileSync(envelopeFile, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((lstatSync(envelopeFile).mode & 0o777) !== 0o600)
      throw new Error('MEDIA_STATE_ENVELOPE_NOT_PRIVATE');
    if (!boundedFile(envelopeFile, 256 * 1024).equals(bytes))
      throw new Error('MEDIA_STATE_ENVELOPE_CHANGED');
  }
  return stateRoot;
}

/**
 * 获取同一步骤密封信封后只执行一个媒体动作，并从已密封业务证据构造标准结果。
 * @param input - 本次工作流标准输入。
 * @returns 标准 data 区中的媒体身份及实际证据摘要。
 * @throws 运行身份、领域动作、固定配置或业务证据不一致时拒绝成功。
 */
async function execute(input) {
  const root = releaseRoot();
  const configFile = path.join(serviceRoot, 'config', 'workflow', configSha256 + '.json');
  const configBytes = boundedFile(configFile, 64 * 1024);
  if (
    (lstatSync(configFile).mode & 0o777) !== 0o600 ||
    digest(configBytes) !== configSha256
  )
    throw new Error('MEDIA_RUNTIME_CONFIG_CHANGED');
  const { executeRun, parseRunnerConfig } = await import(
    pathToFileURL(path.join(root, 'action-runner.mjs')).href
  );
  const { validateExecutionEnvelope } = await import(
    pathToFileURL(path.join(root, 'executor-contract.mjs')).href
  );
  const { readPrivateLine } = await import(
    pathToFileURL(path.join(root, 'private-file.mjs')).href
  );
  const { MediaExecutorApiClient } = await import(
    pathToFileURL(path.join(root, 'media-api-client.mjs')).href
  );
  const config = parseRunnerConfig(JSON.parse(configBytes.toString('utf8')));
  if (!config.manifestExecutor.startsWith(root + '/'))
    throw new Error('MEDIA_CONFIG_RELEASE_MISMATCH');
  const api = new MediaExecutorApiClient({
    baseUrl: config.apiBaseUrl,
    internalSecret: readPrivateLine(config.internalSecretFile),
  });
  const envelope = validateExecutionEnvelope(await api.workflowEnvelope({
    ...input.params,
    executionKey: input.context.executionKey,
  }));
  const actionMatches =
    envelope.action === input.context.stepKey ||
    (input.context.stepKey === 'governance.rebase' &&
      envelope.action === 'governance.execute') ||
    (input.context.stepKey === 'source.download' &&
      envelope.action === 'source.resume');
  if (
    !actionMatches ||
    envelope.taskId !== input.params.taskId ||
    envelope.runId !== input.params.mediaRunId ||
    envelope.sealedInputSha256 !== input.params.sealedInputSha256 ||
    envelope.replayKey !== input.context.executionKey
  )
    throw new Error('MEDIA_ENVELOPE_IDENTITY_MISMATCH');
  const result = await executeRun({
    config,
    envelope,
    stateRoot: prepareState(envelope),
  });
  const manifestBytes = boundedFile(result.manifestPath, 1024 * 1024);
  if (digest(manifestBytes) !== result.manifestSha256)
    throw new Error('MEDIA_EVIDENCE_MANIFEST_CHANGED');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const journalPath = 'evidence/journal-summary.json';
  const entry = manifest.files.find((file) => file.path === journalPath);
  const journalBytes = boundedFile(
    path.join(path.dirname(result.manifestPath), journalPath),
    64 * 1024,
  );
  if (!entry || digest(journalBytes) !== entry.sha256)
    throw new Error('MEDIA_JOURNAL_CHANGED');
  const journal = JSON.parse(journalBytes.toString('utf8'));
  if (
    journal.runId !== envelope.runId ||
    journal.taskId !== envelope.taskId ||
    journal.terminalEventType !== 'run-succeeded' ||
    !/^[a-f0-9]{64}$/.test(journal.terminalEvidenceSha256 ?? '')
  )
    throw new Error('MEDIA_SUCCESS_EVIDENCE_MISSING');
  return {
    mediaRunId: envelope.runId,
    taskId: envelope.taskId,
    sealedInputSha256: envelope.sealedInputSha256,
    evidenceSha256: journal.terminalEvidenceSha256,
  };
}

const input = await readInput();
try {
  const data = await execute(input);
  process.stdout.write(
    JSON.stringify({
      protocol: input.protocol,
      executionId: input.executionId,
      scriptSha256: input.scriptSha256,
      sequence: 1,
      kind: 'result',
      status: 'succeeded',
      data,
      error: null,
    }) + '\n',
  );
} catch {
  process.stdout.write(
    JSON.stringify({
      protocol: input.protocol,
      executionId: input.executionId,
      scriptSha256: input.scriptSha256,
      sequence: 1,
      kind: 'result',
      status: 'failed',
      data: {},
      error: {
        code: 'MEDIA_STEP_FAILED',
        message: '媒体步骤未通过执行或证据校验',
      },
    }) + '\n',
  );
  process.exitCode = 1;
}
