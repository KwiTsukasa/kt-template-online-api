#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOCAL_MEDIA_ROOT = "/vol2/1000/Media";
const LOCAL_STAGING_PARENT = "/vol2/1000/.kt-media-governance-staging";
const EVIDENCE_ROOT = "/vol1/docker/kt-media-governance/evidence";
const CLOUD_MEDIA_ROOT = "/Media/movie";
const DEFAULT_JOURNAL_ROOT = "/vol1/docker/kt-media-governance/journals";
const BOUNDED_CHUNK_BYTES = 4 * 1024 * 1024;
const VERIFICATION_PROGRESS_BYTES = 64 * 1024 * 1024;
const VERIFICATION_CACHE_SCHEMA = "media-manifest-verification-cache-v1";
const VERIFICATION_PROGRESS_SCHEMA = "media-manifest-verification-progress-v1";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const ALIST_HELPER_PATH = fileURLToPath(
  new URL("./alist-native-api-helper.py", import.meta.url),
);

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

/**
 * 创建或复核只允许当前用户访问的真实目录，防止摘要检查点落入符号链接或宽权限位置。
 * @param {string} directory - 需要作为检查点根或计划子目录的绝对规范路径。
 * @throws 当目录越界、不是普通目录、是符号链接或向组/其他用户开放时抛出。
 */
function ensurePrivateDirectory(directory) {
  assertNormalizedAbsolute(directory, "Verification cache directory");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("verification-cache-directory-invalid");
  }
}

/**
 * 将小型检查点 JSON 以 0600 临时文件写入并原子替换目标，避免进程中断留下可被误读的半行状态。
 * @param {string} file - 位于私有检查点目录内的目标 JSON 路径。
 * @param {object} payload - 已完成规范化且不含媒体路径之外敏感内容的检查点对象。
 * @throws 当既有目标不安全、临时文件无法持久化或原子替换失败时抛出。
 */
function writePrivateJson(file, payload) {
  ensurePrivateDirectory(path.posix.dirname(file));
  if (existsSync(file)) {
    const existing = lstatSync(file);
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      (existing.mode & 0o077) !== 0
    ) {
      throw new Error("verification-cache-file-invalid");
    }
  }
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    writeSync(descriptor, `${stableSerialize(payload)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/**
 * 从私有普通文件读取有界 JSON，并拒绝符号链接、宽权限、空文件和超大伪造记录。
 * @param {string} file - 需要读取的精确检查点或进度文件。
 * @returns {object|null} 文件不存在时返回 null，否则返回解析后的普通 JSON 对象。
 * @throws 当文件身份、权限、大小或 JSON 结构不安全时抛出。
 */
function readPrivateJson(file) {
  if (!existsSync(file)) return null;
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size < 2 ||
    stat.size > 32 * 1024
  ) {
    throw new Error("verification-cache-file-invalid");
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("verification-cache-json-invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("verification-cache-json-invalid");
  }
  return payload;
}

/**
 * 把文件系统身份投影为无精度损失的十进制文本和纳秒时间，供完整摘要缓存严格比较。
 * @param {object} stat - 由本地 I/O 层返回的普通文件状态。
 * @returns {{ctimeNs:string,device:string,inode:string,linkCount:string,mtimeNs:string,size:number}} 可稳定序列化的文件身份。
 * @throws 当 inode、设备号、纳秒时间、链接数或大小不完整时抛出。
 */
function verificationFileIdentity(stat) {
  const device = `${stat.dev ?? ""}`;
  const inode = `${stat.ino ?? ""}`;
  const mtimeNs = `${stat.mtimeNs ?? ""}`;
  const ctimeNs = `${stat.ctimeNs ?? ""}`;
  const linkCount = `${stat.nlink ?? ""}`;
  if (
    !/^\d+$/u.test(device) ||
    !/^\d+$/u.test(inode) ||
    !/^\d+$/u.test(mtimeNs) ||
    !/^\d+$/u.test(ctimeNs) ||
    !/^[1-9]\d*$/u.test(linkCount) ||
    !Number.isSafeInteger(stat.size) ||
    stat.size < 0
  ) {
    throw new Error("verification-cache-file-identity-invalid");
  }
  return {
    ctimeNs,
    device,
    inode,
    linkCount,
    mtimeNs,
    size: stat.size,
  };
}

/**
 * 将计划、清单、证据、工具和当前文件身份组合为单文件完整摘要检查点正文。
 * @param {object} plan - 当前已密封 Schema 1.2.0 计划。
 * @param {string} filePath - 当前证据实际所在的绝对路径。
 * @param {object} evidence - 计划内唯一的本地来源证据。
 * @param {object} stat - 摘要完成后同一文件的稳定状态。
 * @param {string} verifierSha256 - 当前 manifest executor 的发布摘要。
 * @returns {object} 绑定同计划、同清单、同证据和同文件身份的检查点正文。
 */
function verificationRecordPayload(
  plan,
  filePath,
  evidence,
  stat,
  verifierSha256,
) {
  return {
    ...verificationFileIdentity(stat),
    digest: evidence.digest,
    evidenceId: evidence.evidenceId,
    evidenceMethod: evidence.evidenceMethod,
    fileKind: evidence.fileKind,
    localManifestSha256: plan.execution.manifestSha256.localForward,
    path: filePath,
    planSha256: sha256(plan),
    schemaVersion: VERIFICATION_CACHE_SCHEMA,
    verifierSha256,
  };
}

/**
 * 仅以证据 ID 的 SHA-256 作为记录文件名，阻止未受字符集约束的 ID 穿越检查点目录。
 * @param {string} planRoot - 已由计划摘要派生的私有检查点目录。
 * @param {string} evidenceId - 当前来源证据的原始标识。
 * @returns {string} 始终位于计划目录直属层的六十四位摘要 JSON 路径。
 */
function verificationRecordPath(planRoot, evidenceId) {
  const fileName = `${createHash("sha256").update(evidenceId).digest("hex")}.json`;
  const candidate = path.posix.join(planRoot, fileName);
  if (path.posix.dirname(candidate) !== planRoot) {
    throw new Error("verification-cache-record-boundary-invalid");
  }
  return candidate;
}

/**
 * 创建计划级逐文件摘要缓存；命中必须精确匹配工具、清单、证据及纳秒级 live stat，写入只发生在完整哈希或受控 rename 后。
 * @param {string} cacheRoot - 当前 Task 专属的私有摘要缓存根。
 * @param {object} plan - 当前已密封计划。
 * @param {{attemptId?:string,verifierSha256?:string}} options - 当前 Run 标识与 manifest executor 发布摘要。
 * @returns {object} 提供命中、原子记录和脱敏进度写入能力的计划级缓存。
 */
export function createFileVerificationCache(cacheRoot, plan, options = {}) {
  assertNormalizedAbsolute(cacheRoot, "Verification cache root");
  ensurePrivateDirectory(cacheRoot);
  const planSha256 = sha256(plan);
  const planRoot = path.posix.join(cacheRoot, planSha256);
  ensurePrivateDirectory(planRoot);
  let verifierSha256 = options.verifierSha256;
  if (!verifierSha256) {
    verifierSha256 = digestFile(fileURLToPath(import.meta.url), "sha256-full-v1");
  }
  if (!DIGEST_PATTERN.test(verifierSha256)) {
    throw new Error("verification-cache-verifier-invalid");
  }
  let attemptId = options.attemptId;
  if (!attemptId) attemptId = "standalone";
  const progressPath = path.posix.join(planRoot, "progress.json");
  return {
    attemptId,
    matches: (filePath, evidence, stat) => {
      const record = readPrivateJson(
        verificationRecordPath(planRoot, evidence.evidenceId),
      );
      if (!record) return false;
      const expected = verificationRecordPayload(
        plan,
        filePath,
        evidence,
        stat,
        verifierSha256,
      );
      return stableSerialize(record) === stableSerialize(expected);
    },
    planRoot,
    planSha256,
    progressPath,
    record: (filePath, evidence, stat) => {
      const payload = verificationRecordPayload(
        plan,
        filePath,
        evidence,
        stat,
        verifierSha256,
      );
      const recordPath = verificationRecordPath(planRoot, evidence.evidenceId);
      writePrivateJson(recordPath, payload);
      const stored = readPrivateJson(recordPath);
      if (stableSerialize(stored) !== stableSerialize(payload)) {
        throw new Error("verification-cache-record-write-drift");
      }
    },
    writeProgress: (progress) => {
      writePrivateJson(progressPath, {
        ...progress,
        attemptId,
        direction: progress.direction,
        planSha256,
        schemaVersion: VERIFICATION_PROGRESS_SCHEMA,
      });
    },
  };
}

export function computeManifestDigests(manifests) {
  return {
    cloudSidecarForward: sha256(manifests.cloudSidecarQuarantine.forward),
    cloudSidecarInverse: sha256(manifests.cloudSidecarQuarantine.inverse),
    cloudVideoForward: sha256(manifests.cloudVideo.forward),
    cloudVideoInverse: sha256(manifests.cloudVideo.inverse),
    localForward: sha256(manifests.local.forward),
    localInverse: sha256(manifests.local.inverse),
  };
}

function isInsideRoot(root, candidate) {
  const relative = path.posix.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !path.posix.isAbsolute(relative)
  );
}

function isIndexedTemporaryStagingPath(candidate) {
  if (!isInsideRoot(LOCAL_MEDIA_ROOT, candidate)) return false;
  return path.posix
    .relative(LOCAL_MEDIA_ROOT, candidate)
    .split("/")
    .some((segment) => /^(?:\.kt-)?(?:canonical-)?staging(?:-|$)/i.test(segment));
}

function assertNormalizedAbsolute(candidate, label) {
  if (
    typeof candidate !== "string" ||
    !path.posix.isAbsolute(candidate) ||
    path.posix.normalize(candidate) !== candidate ||
    candidate.includes("\0")
  ) {
    throw new Error(`${label} must be an absolute normalized POSIX path.`);
  }
}

/**
 * 在同一媒体总根内仅接受带精确旧作品根与唯一新作品根的系列收敛边界。
 * @param {object} plan - 已密封的 Schema 1.2.0 本地事务计划。
 * @param {string} sharedRoot - 来源和目标共同声明的媒体总根。
 * @returns {{sourceRoots: string[], targetRoot: string}|null} 合法系列收敛边界；普通计划返回 `null`。
 */
function seriesReconciliationBoundary(plan, sharedRoot) {
  const reconciliation = plan?.seriesReconciliation;
  if (!reconciliation || typeof reconciliation !== "object" || Array.isArray(reconciliation)) {
    return null;
  }
  const sourceRoots = reconciliation.sourceTitleRoots;
  const targetRoot = reconciliation.targetTitleRoot;
  const title = reconciliation.canonicalTitle;
  const releaseYear = reconciliation.releaseYear;
  if (
    !Array.isArray(sourceRoots) ||
    sourceRoots.length === 0 ||
    new Set(sourceRoots).size !== sourceRoots.length ||
    typeof targetRoot !== "string" ||
    typeof title !== "string" ||
    !title.trim() ||
    !Number.isSafeInteger(releaseYear)
  ) {
    throw new Error("Series reconciliation boundary is invalid.");
  }
  assertNormalizedAbsolute(targetRoot, "Series reconciliation target root");
  if (!isInsideRoot(sharedRoot, targetRoot)) {
    throw new Error("Series reconciliation target escaped the shared media root.");
  }
  for (const sourceRoot of sourceRoots) {
    assertNormalizedAbsolute(sourceRoot, "Series reconciliation source root");
    if (
      !isInsideRoot(sharedRoot, sourceRoot) ||
      sourceRoot === targetRoot ||
      isInsideRoot(sourceRoot, targetRoot) ||
      isInsideRoot(targetRoot, sourceRoot)
    ) {
      throw new Error("Series reconciliation roots overlap or escape the shared media root.");
    }
  }
  return { sourceRoots, targetRoot };
}

function operationIdentity(operation) {
  return stableSerialize({
    evidenceId: operation.evidenceId,
    fileKind: operation.fileKind,
    subtitle: operation.subtitle,
  });
}

function isValidCloudTransport(transport) {
  if (transport?.type === "alist-native-api") {
    return (
      transport.apiBase === "http://127.0.0.1:5244/alist" &&
      transport.storageRoot === CLOUD_MEDIA_ROOT &&
      transport.username === "admin"
    );
  }
  return (
    transport?.type === "rclone-webdav" &&
    /^\/etc\/mountmgr\/rclone\/[^/]+\.conf$/.test(transport.configPath ?? "") &&
    /^[A-Za-z0-9._-]+:alist\/dav$/.test(transport.remoteRoot ?? "")
  );
}

function validateCloudBatchGate(gate) {
  if (
    !gate ||
    gate.executionOrder !== "local-all-then-cloud-batch" ||
    gate.favoritePolicy !== "preserve" ||
    gate.playbackHistoryPolicy !== "discard" ||
    !Number.isInteger(gate.expectedItemCount) ||
    gate.expectedItemCount <= 0 ||
    gate.localReconciledItemCount !== gate.expectedItemCount ||
    !/^[a-f0-9]{64}$/i.test(gate.ledgerSha256 ?? "") ||
    Number.isNaN(Date.parse(gate.verifiedAt ?? ""))
  ) {
    throw new Error(
      "Cloud execution requires a sealed all-local-items-reconciled batch gate.",
    );
  }
}

function validateLocalExecutionPlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("Plan must be an object.");
  if (plan.schemaVersion !== "1.2.0") {
    throw new Error("Executor accepts media title plan schema 1.2.0 only.");
  }
  if (plan.sealed !== true || typeof plan.sealedAt !== "string") {
    throw new Error("Executor accepts a sealed media title plan only.");
  }
  if (!/^media-\d{3}$/.test(plan.workItemId ?? "")) {
    throw new Error("Plan workItemId is invalid.");
  }
  if (!plan.execution || !plan.manifests || !Array.isArray(plan.sourceEvidence)) {
    throw new Error("Plan lacks its execution envelope, manifests, or source evidence.");
  }
  const executionPhase = plan.execution.phase;
  const legacyCombinedPlan = executionPhase === undefined;
  if (
    !legacyCombinedPlan &&
    !["local-only", "cloud-after-local-batch"].includes(executionPhase)
  ) {
    throw new Error("Execution phase must be local-only or cloud-after-local-batch.");
  }
  if (executionPhase === "local-only") {
    const cloudOperations = [
      ...plan.manifests.cloudVideo.forward,
      ...plan.manifests.cloudVideo.inverse,
      ...plan.manifests.cloudSidecarQuarantine.forward,
      ...plan.manifests.cloudSidecarQuarantine.inverse,
    ];
    if (cloudOperations.length > 0) {
      throw new Error("A local-only execution plan cannot carry cloud operations.");
    }
    if (plan.sourceEvidence.some((evidence) => evidence.scope === "cloud")) {
      throw new Error("A local-only execution plan cannot carry cloud source evidence.");
    }
    if (Array.isArray(plan.targetAbsenceEvidence) && plan.targetAbsenceEvidence.length > 0) {
      throw new Error("A local-only execution plan cannot carry cloud target evidence.");
    }
    if (plan.execution.cloudTransport || plan.execution.batchGate) {
      throw new Error("A local-only execution plan cannot carry cloud credentials or a batch gate.");
    }
  } else {
    if (!isValidCloudTransport(plan.execution.cloudTransport)) {
      throw new Error("Plan cloudTransport is missing or invalid.");
    }
    if (!legacyCombinedPlan) validateCloudBatchGate(plan.execution.batchGate);
  }
  if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/.test(plan.execution.replayKey ?? "")) {
    throw new Error("Execution replay key is invalid.");
  }

  const expectedDigests = computeManifestDigests(plan.manifests);
  for (const [key, expected] of Object.entries(expectedDigests)) {
    if (plan.execution.manifestSha256?.[key] !== expected) {
      throw new Error(`${key} manifest SHA-256 does not match the sealed plan.`);
    }
  }

  const sourceRoot = plan.execution.allowlists?.localSourceRoot;
  const stagingRoot = plan.execution.allowlists?.localStagingRoot;
  const targetRoot = plan.execution.allowlists?.localTargetRoot;
  assertNormalizedAbsolute(sourceRoot, "Local source allowlist");
  assertNormalizedAbsolute(targetRoot, "Local target allowlist");
  if (!isInsideRoot(LOCAL_MEDIA_ROOT, sourceRoot)) {
    throw new Error(`Local source allowlist must stay inside ${LOCAL_MEDIA_ROOT}.`);
  }
  if (!isInsideRoot(LOCAL_MEDIA_ROOT, targetRoot)) {
    throw new Error(`Local target allowlist must stay inside ${LOCAL_MEDIA_ROOT}.`);
  }
  if (stagingRoot !== undefined) {
    assertNormalizedAbsolute(stagingRoot, "Local staging allowlist");
    if (!isInsideRoot(LOCAL_STAGING_PARENT, stagingRoot)) {
      throw new Error(
        `Local staging allowlist must stay inside ${LOCAL_STAGING_PARENT}.`,
      );
    }
  }
  let sharedSeriesBoundary = null;
  if (sourceRoot === targetRoot) {
    sharedSeriesBoundary = seriesReconciliationBoundary(plan, sourceRoot);
  }
  if (sourceRoot === targetRoot && sharedSeriesBoundary === null) {
    throw new Error("Local source and target allowlists must be distinct.");
  }

  const evidenceById = new Map();
  for (const evidence of plan.sourceEvidence) {
    if (evidenceById.has(evidence.evidenceId)) {
      throw new Error(`Duplicate source evidence ID: ${evidence.evidenceId}.`);
    }
    evidenceById.set(evidence.evidenceId, evidence);
  }

  const forward = plan.manifests.local?.forward;
  const inverse = plan.manifests.local?.inverse;
  if (!Array.isArray(forward) || !Array.isArray(inverse) || forward.length === 0) {
    throw new Error("Local forward and inverse manifests must be non-empty arrays.");
  }

  const sourceKeys = new Set();
  const targetKeys = new Set();
  for (const operation of forward) {
    assertNormalizedAbsolute(operation.sourcePath, "Local source path");
    assertNormalizedAbsolute(operation.targetPath, "Local target path");
    if ((operation.operation ?? "move") !== "move") {
      throw new Error("Local executor accepts move operations only.");
    }
    if (!["asset", "subtitle", "video"].includes(operation.fileKind)) {
      throw new Error("Local operation fileKind is invalid.");
    }
    if (isIndexedTemporaryStagingPath(operation.sourcePath)) {
      throw new Error("Temporary staging must stay outside the indexed media root.");
    }
    if (
      !isInsideRoot(sourceRoot, operation.sourcePath) &&
      !(stagingRoot && isInsideRoot(stagingRoot, operation.sourcePath))
    ) {
      throw new Error(`Local source is outside the source allowlist: ${operation.sourcePath}.`);
    }
    if (!isInsideRoot(targetRoot, operation.targetPath)) {
      throw new Error(`Local target is outside the target allowlist: ${operation.targetPath}.`);
    }
    if (
      sharedSeriesBoundary !== null &&
      (!sharedSeriesBoundary.sourceRoots.some((root) =>
        isInsideRoot(root, operation.sourcePath),
      ) || !isInsideRoot(sharedSeriesBoundary.targetRoot, operation.targetPath))
    ) {
      throw new Error("Series reconciliation operation escaped its sealed title roots.");
    }
    const sourceKey = operation.sourcePath.toLocaleLowerCase("en-US");
    const targetKey = operation.targetPath.toLocaleLowerCase("en-US");
    if (sourceKeys.has(sourceKey)) throw new Error("Local manifest has a case-fold source collision.");
    if (targetKeys.has(targetKey)) throw new Error("Local manifest has a case-fold target collision.");
    sourceKeys.add(sourceKey);
    targetKeys.add(targetKey);

    const evidence = evidenceById.get(operation.evidenceId);
    if (
      !evidence ||
      evidence.scope !== "local" ||
      evidence.fileKind !== operation.fileKind ||
      evidence.path !== operation.sourcePath
    ) {
      throw new Error(`Local operation lacks exact source evidence: ${operation.evidenceId}.`);
    }
    const hasInverse = inverse.some(
      (candidate) =>
        (candidate.operation ?? "move") === "move" &&
        operationIdentity(candidate) === operationIdentity(operation) &&
        candidate.sourcePath === operation.targetPath &&
        candidate.targetPath === operation.sourcePath,
    );
    if (!hasInverse) {
      throw new Error(`Local operation lacks an exact inverse: ${operation.targetPath}.`);
    }
  }

  for (const operation of inverse) {
    const hasForward = forward.some(
      (candidate) =>
        (operation.operation ?? "move") === "move" &&
        operationIdentity(candidate) === operationIdentity(operation) &&
        candidate.sourcePath === operation.targetPath &&
        candidate.targetPath === operation.sourcePath,
    );
    if (!hasForward) throw new Error("Local inverse has no exact forward operation.");
  }

  return { evidenceById, legacyCombinedPlan, sourceRoot, stagingRoot, targetRoot };
}

function validateCloudExecutionPlan(plan, options = {}) {
  if (plan?.execution?.phase === "local-only") {
    throw new Error("A local-only plan cannot execute cloud scope.");
  }
  if (
    plan?.execution?.phase === undefined &&
    options.allowLegacyRollback !== true
  ) {
    throw new Error("A legacy combined plan is rollback-only.");
  }
  if (
    plan?.execution?.phase !== undefined &&
    plan.execution.phase !== "cloud-after-local-batch"
  ) {
    throw new Error("Cloud scope requires a cloud-after-local-batch execution plan.");
  }
  const { evidenceById } = validateLocalExecutionPlan(plan);
  const allowlists = plan.execution.allowlists ?? {};
  const cloudVideoSourceRoot = allowlists.cloudVideoSourceRoot;
  const cloudVideoTargetRoot = allowlists.cloudVideoTargetRoot;
  const cloudSidecarSourceRoot = allowlists.cloudSidecarSourceRoot;
  const cloudSidecarQuarantineRoot = allowlists.cloudSidecarQuarantineRoot;
  const cloudStorageRoot = CLOUD_MEDIA_ROOT;
  for (const [label, root] of [
    ["Cloud video source allowlist", cloudVideoSourceRoot],
    ["Cloud video target allowlist", cloudVideoTargetRoot],
    ["Cloud sidecar source allowlist", cloudSidecarSourceRoot],
    ["Cloud sidecar quarantine allowlist", cloudSidecarQuarantineRoot],
  ]) {
    assertNormalizedAbsolute(root, label);
    if (!isInsideRoot(cloudStorageRoot, root)) {
      throw new Error(`${label} must stay inside ${cloudStorageRoot}.`);
    }
  }

  const localTargetByEvidenceId = new Map(
    plan.manifests.local.forward.map((operation) => [operation.evidenceId, operation.targetPath]),
  );
  const groups = [
    {
      acceptedKinds: ["video"],
      forward: plan.manifests.cloudVideo?.forward,
      inverse: plan.manifests.cloudVideo?.inverse,
      kind: "video",
    },
    {
      acceptedKinds: ["asset", "subtitle"],
      forward: plan.manifests.cloudSidecarQuarantine?.forward,
      inverse: plan.manifests.cloudSidecarQuarantine?.inverse,
      kind: "non-video",
    },
  ];
  const allForward = [];
  const allInverse = [];
  for (const group of groups) {
    if (!Array.isArray(group.forward) || !Array.isArray(group.inverse)) {
      throw new Error("Cloud forward and inverse manifests must be arrays.");
    }
    allForward.push(...group.forward);
    allInverse.push(...group.inverse);
    for (const operation of group.forward) {
      if (!group.acceptedKinds.includes(operation.fileKind)) {
        throw new Error("Cloud operation fileKind does not match its manifest.");
      }
      assertNormalizedAbsolute(operation.sourcePath, "Cloud operation source path");
      assertNormalizedAbsolute(operation.targetPath, "Cloud operation target path");
      const evidence = evidenceById.get(operation.evidenceId);
      if (!evidence || evidence.fileKind !== operation.fileKind) {
        throw new Error(`Cloud operation lacks source evidence: ${operation.evidenceId}.`);
      }
      if (group.kind === "video" && operation.operation === "move") {
        if (
          !isInsideRoot(cloudVideoSourceRoot, operation.sourcePath) ||
          !isInsideRoot(cloudVideoTargetRoot, operation.targetPath) ||
          evidence.scope !== "cloud" ||
          evidence.path !== operation.sourcePath
        ) {
          throw new Error(`Cloud video move is outside its sealed evidence or allowlist.`);
        }
      } else if (group.kind === "video" && operation.operation === "upload") {
        if (
          !isInsideRoot(allowlists.localTargetRoot, operation.sourcePath) ||
          !isInsideRoot(cloudVideoTargetRoot, operation.targetPath) ||
          evidence.scope !== "local" ||
          localTargetByEvidenceId.get(operation.evidenceId) !== operation.sourcePath
        ) {
          throw new Error(`Cloud video upload is outside its sealed evidence or allowlist.`);
        }
      } else if (group.kind === "non-video" && operation.operation === "move") {
        if (
          !isInsideRoot(cloudSidecarSourceRoot, operation.sourcePath) ||
          !isInsideRoot(cloudSidecarQuarantineRoot, operation.targetPath) ||
          evidence.scope !== "cloud" ||
          evidence.path !== operation.sourcePath
        ) {
          throw new Error(`Cloud sidecar move is outside its sealed evidence or allowlist.`);
        }
      } else {
        throw new Error("Cloud forward operation is invalid.");
      }

      const expectedInverseOperation = operation.operation === "upload" ? "remove-upload" : "move";
      const hasInverse = group.inverse.some(
        (candidate) =>
          candidate.operation === expectedInverseOperation &&
          operationIdentity(candidate) === operationIdentity(operation) &&
          candidate.sourcePath === operation.targetPath &&
          candidate.targetPath === operation.sourcePath,
      );
      if (!hasInverse) {
        throw new Error(`Cloud operation lacks an exact inverse: ${operation.targetPath}.`);
      }
    }
  }
  if (allForward.length === 0) throw new Error("Cloud manifests must not be empty.");

  const sourceKeys = new Set();
  const targetKeys = new Set();
  for (const operation of allForward) {
    const sourceKey = operation.sourcePath.toLocaleLowerCase("en-US");
    const targetKey = operation.targetPath.toLocaleLowerCase("en-US");
    if (sourceKeys.has(sourceKey)) throw new Error("Cloud manifest has a case-fold source collision.");
    if (targetKeys.has(targetKey)) throw new Error("Cloud manifest has a case-fold target collision.");
    sourceKeys.add(sourceKey);
    targetKeys.add(targetKey);
  }
  for (const operation of allInverse) {
    const expectedForwardOperation = operation.operation === "remove-upload" ? "upload" : "move";
    const hasForward = allForward.some(
      (candidate) =>
        candidate.operation === expectedForwardOperation &&
        operationIdentity(candidate) === operationIdentity(operation) &&
        candidate.sourcePath === operation.targetPath &&
        candidate.targetPath === operation.sourcePath,
    );
    if (!hasForward) throw new Error("Cloud inverse has no exact forward operation.");
  }

  return { evidenceById };
}

/**
 * 比较两次文件状态是否指向同一份未变化内容，包含纳秒时间、链接数和无精度损失 inode。
 * @param {object} left - 第一次读取或缓存记录对应的文件状态。
 * @param {object} right - 第二次读取或受控转换后的文件状态。
 * @returns {boolean} 两端精确身份一致时返回 true。
 */
function sameVerificationIdentity(left, right) {
  return (
    stableSerialize(verificationFileIdentity(left)) ===
    stableSerialize(verificationFileIdentity(right))
  );
}

/**
 * 比较同设备 rename 前后的内容身份；只允许 ctime 改变，inode、链接数、大小和 mtime 必须保持。
 * @param {object} before - rename 前已验证来源的文件状态。
 * @param {object} after - rename 后目标路径的文件状态。
 * @returns {boolean} 仅发生同一 inode 路径转换时返回 true。
 */
function sameRenameIdentity(before, after) {
  const left = verificationFileIdentity(before);
  const right = verificationFileIdentity(after);
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.linkCount === right.linkCount &&
    left.mtimeNs === right.mtimeNs &&
    left.size === right.size
  );
}

/**
 * 核对普通文件大小与密封 mtime，优先复用精确检查点，否则在稳定 stat 包围内计算摘要并原子记录。
 * @param {string} filePath - 当前待验证的来源或受控转换后目标路径。
 * @param {object} evidence - 与该路径一一对应的密封来源证据。
 * @param {object} io - 提供 stat、摘要和可选同 fd 验证能力的本地 I/O 实现。
 * @param {object} options - 检查点、强制命中开关与当前文件字节进度回调。
 * @returns {{cacheHit:boolean,stat:object}} 本次是否复用检查点及摘要完成后的稳定文件状态。
 * @throws 当文件、密封属性、摘要、检查点或哈希期间身份发生漂移时抛出。
 */
function validateFileEvidence(filePath, evidence, io, options = {}) {
  const actual = io.stat(filePath);
  if (!actual.isFile) throw new Error(`Source is not a regular file: ${filePath}.`);
  if (actual.size !== evidence.size) {
    throw new Error(`Source size changed for ${evidence.evidenceId}.`);
  }
  if (Math.trunc(actual.mtimeMs) !== Math.trunc(evidence.mtimeMs)) {
    throw new Error(`Source mtime changed for ${evidence.evidenceId}.`);
  }
  const verificationCache = options.verificationCache;
  if (verificationCache?.matches(filePath, evidence, actual)) {
    return { cacheHit: true, stat: actual };
  }
  if (options.requireVerificationCache === true) {
    throw new Error(
      `Verification cache is incomplete or stale for ${evidence.evidenceId}.`,
    );
  }
  if (evidence.digest) {
    let actualDigest;
    let verifiedStat;
    if (typeof io.verify === "function") {
      const verified = io.verify(
        filePath,
        evidence.evidenceMethod,
        options.onDigestProgress,
      );
      if (!sameVerificationIdentity(verified.before, verified.after)) {
        throw new Error(
          `Source changed while hashing ${evidence.evidenceId}.`,
        );
      }
      actualDigest = verified.digest;
      verifiedStat = verified.after;
    } else {
      const before = io.stat(filePath);
      actualDigest = io.digest(filePath, evidence.evidenceMethod);
      const after = io.stat(filePath);
      if (!sameVerificationIdentity(before, after)) {
        throw new Error(
          `Source changed while hashing ${evidence.evidenceId}.`,
        );
      }
      verifiedStat = after;
    }
    if (actualDigest !== evidence.digest) {
      throw new Error(`Source digest changed for ${evidence.evidenceId}.`);
    }
    verificationCache?.record(filePath, evidence, verifiedStat);
    return { cacheHit: false, stat: verifiedStat };
  }
  return { cacheHit: false, stat: actual };
}

/**
 * 把计划中的电影规范替换合同与 backup hardlink 收据绑定为本地执行上下文。
 * @param {object} plan - 当前已密封 Schema 1.2.0 计划。
 * @param {object|undefined} backup - 由本次计划预先生成的私有事务备份收据。
 * @param {object} io - 用于读取 rollback hardlink 身份的本地 I/O。
 * @returns {object|null} 普通计划返回空值，替换计划返回旧目标与 rollback 收据。
 * @throws 当合同、视频目标、备份路径或 hardlink 身份不一致时抛出。
 */
function canonicalReplacementContext(plan, backup, io) {
  const replacement = plan?.canonicalReplacement;
  if (replacement === undefined) {
    if (backup !== undefined) {
      throw new Error("Unexpected canonical replacement backup.");
    }
    return null;
  }
  const expectedKeys = [
    "replacedPlanSha256",
    "replacedTaskId",
    "replacedTaskRevision",
    "replacedWorkItemId",
    "schemaVersion",
    "targetEvidence",
  ];
  const targetEvidence = replacement?.targetEvidence;
  const evidenceKeys = [
    "digest",
    "evidenceId",
    "evidenceMethod",
    "fileKind",
    "mtimeMs",
    "path",
    "scope",
    "size",
  ];
  const videoOperations = plan.manifests.local.forward.filter(
    (operation) => operation.fileKind === "video",
  );
  const contractInvalid =
    !replacement ||
    typeof replacement !== "object" ||
    Array.isArray(replacement) ||
    stableSerialize(Object.keys(replacement).sort()) !==
      stableSerialize(expectedKeys.sort()) ||
    !targetEvidence ||
    typeof targetEvidence !== "object" ||
    Array.isArray(targetEvidence) ||
    stableSerialize(Object.keys(targetEvidence).sort()) !==
      stableSerialize(evidenceKeys.sort()) ||
    replacement.schemaVersion !== "media-canonical-replacement-v1" ||
    !DIGEST_PATTERN.test(String(replacement.replacedPlanSha256 ?? "")) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/u.test(
      String(replacement.replacedTaskId ?? ""),
    ) ||
    !/^media-\d{3}$/u.test(String(replacement.replacedWorkItemId ?? "")) ||
    !Number.isInteger(replacement.replacedTaskRevision) ||
    replacement.replacedTaskRevision < 1 ||
    targetEvidence.evidenceMethod !== "sha256-full-v1" ||
    targetEvidence.fileKind !== "video" ||
    targetEvidence.scope !== "local" ||
    !DIGEST_PATTERN.test(String(targetEvidence.digest ?? "")) ||
    !Number.isSafeInteger(targetEvidence.mtimeMs) ||
    targetEvidence.mtimeMs < 0 ||
    !Number.isSafeInteger(targetEvidence.size) ||
    targetEvidence.size < 1 ||
    videoOperations.length !== 1 ||
    videoOperations[0].targetPath !== targetEvidence.path;
  if (contractInvalid) {
    throw new Error("Canonical replacement contract is invalid.");
  }
  const receipts = backup?.replacedCanonicalVideos;
  if (
    backup?.schemaVersion !== "media-local-transaction-backup-v1" ||
    backup?.state !== "transaction-backup-complete" ||
    !path.posix.isAbsolute(String(backup?.rollbackRoot ?? "")) ||
    !Array.isArray(receipts) ||
    receipts.length !== 1
  ) {
    throw new Error("Canonical replacement backup is invalid.");
  }
  const receipt = receipts[0];
  const rollbackPath = path.posix.resolve(String(receipt?.rollbackPath ?? ""));
  const rollbackRoot = path.posix.resolve(backup.rollbackRoot);
  const receiptInvalid =
    receipt?.targetPath !== targetEvidence.path ||
    receipt?.digest !== targetEvidence.digest ||
    receipt?.evidenceMethod !== targetEvidence.evidenceMethod ||
    receipt?.size !== targetEvidence.size ||
    receipt?.replacedTaskId !== replacement.replacedTaskId ||
    receipt?.replacedTaskRevision !== replacement.replacedTaskRevision ||
    receipt?.replacedWorkItemId !== replacement.replacedWorkItemId ||
    receipt?.replacedPlanSha256 !== replacement.replacedPlanSha256 ||
    receipt?.workItemId !== plan.workItemId ||
    !rollbackPath.startsWith(`${rollbackRoot}/`) ||
    !io.exists(rollbackPath);
  if (receiptInvalid) {
    throw new Error("Canonical replacement receipt is invalid.");
  }
  const rollbackStat = io.stat(rollbackPath);
  if (
    !rollbackStat.isFile ||
    `${rollbackStat.dev}` !== `${receipt.device}` ||
    `${rollbackStat.ino}` !== `${receipt.inode}` ||
    rollbackStat.size !== receipt.size ||
    rollbackStat.mtimeMs !== targetEvidence.mtimeMs
  ) {
    throw new Error("Canonical replacement rollback hardlink changed.");
  }
  return {
    receipt: { ...receipt, rollbackPath },
    targetEvidence,
    targetPath: targetEvidence.path,
  };
}

/**
 * 核对替换前的规范目标仍与 backup hardlink 指向同一旧视频 inode。
 * @param {object} replacement - 已通过计划与备份合同校验的替换上下文。
 * @param {object} io - 本地文件状态 I/O。
 * @throws 当旧目标缺失、不是普通文件或身份漂移时抛出。
 */
function validateExistingCanonicalTarget(replacement, io) {
  if (!io.exists(replacement.targetPath)) {
    throw new Error("Canonical replacement target is missing.");
  }
  const target = io.stat(replacement.targetPath);
  const receipt = replacement.receipt;
  if (
    !target.isFile ||
    `${target.dev}` !== `${receipt.device}` ||
    `${target.ino}` !== `${receipt.inode}` ||
    target.size !== receipt.size ||
    target.mtimeMs !== replacement.targetEvidence.mtimeMs
  ) {
    throw new Error("Canonical replacement target changed.");
  }
}

/**
 * 在候选视频已回到 staging 后从受保护 hardlink 恢复旧规范目标目录项。
 * @param {object} replacement - 已验证的规范替换上下文。
 * @param {object} io - 支持同设备 link 与文件身份读取的本地 I/O。
 * @returns 实际恢复旧目标时为 `true`，目标已经是旧 inode 时返回 `false`。
 * @throws 当目标被其他 inode 占用或恢复后的身份不匹配时抛出。
 */
function restoreExistingCanonicalTarget(replacement, io) {
  const receipt = replacement.receipt;
  if (io.exists(replacement.targetPath)) {
    const target = io.stat(replacement.targetPath);
    if (
      `${target.dev}` === `${receipt.device}` &&
      `${target.ino}` === `${receipt.inode}`
    ) {
      return false;
    }
    throw new Error("Canonical replacement restore target is occupied.");
  }
  io.ensureParent(replacement.targetPath);
  if (typeof io.link !== "function") {
    throw new Error("Canonical replacement restore link is unavailable.");
  }
  io.link(receipt.rollbackPath, replacement.targetPath);
  const restored = io.stat(replacement.targetPath);
  if (
    !restored.isFile ||
    `${restored.dev}` !== `${receipt.device}` ||
    `${restored.ino}` !== `${receipt.inode}` ||
    restored.size !== receipt.size ||
    restored.mtimeMs !== replacement.targetEvidence.mtimeMs
  ) {
    throw new Error("Canonical replacement restore identity changed.");
  }
  return true;
}

/**
 * 逐操作核对本地清单并写入单调字节进度，使大批量摘要可按已完成文件恢复且保持目标/设备门禁。
 * @param {object} plan - 当前已密封本地计划。
 * @param {"forward"|"inverse"} direction - 当前准备执行或回滚的方向。
 * @param {object} io - 本地文件与服务状态 I/O。
 * @param {object} options - 摘要缓存、强制命中和公开进度回调。
 * @returns {object} 预检状态、操作/字节总量以及缓存与新哈希计数。
 */
function preflightLocal(plan, direction, io, options = {}) {
  const { evidenceById } = validateLocalExecutionPlan(plan);
  const replacement = canonicalReplacementContext(
    plan,
    options.replacementBackup,
    io,
  );
  if (!['forward', 'inverse'].includes(direction)) {
    throw new Error("Direction must be forward or inverse.");
  }
  const operations = plan.manifests.local[direction];
  const totalBytes = operations.reduce(
    (sum, operation) => sum + evidenceById.get(operation.evidenceId).size,
    0,
  );
  const sourceKeys = new Set();
  const targetKeys = new Set();
  let cacheHitCount = 0;
  let completedBytes = 0;
  let completedItems = 0;
  let hashedItemCount = 0;
  const publishProgress = (event) => {
    const progress = {
      cacheHitCount,
      completedBytes: event.completedBytes,
      completedItems,
      hashedItemCount,
      totalBytes,
      totalItems: operations.length,
    };
    options.onProgress?.(progress);
    options.verificationCache?.writeProgress({
      ...progress,
      direction,
    });
  };
  publishProgress({ completedBytes: 0 });
  for (const operation of operations) {
    const sourceKey = operation.sourcePath.toLocaleLowerCase("en-US");
    const targetKey = operation.targetPath.toLocaleLowerCase("en-US");
    if (sourceKeys.has(sourceKey) || targetKeys.has(targetKey)) {
      throw new Error("Selected local manifest has a case-fold collision.");
    }
    sourceKeys.add(sourceKey);
    targetKeys.add(targetKey);
    if (!io.exists(operation.sourcePath)) {
      throw new Error(`Source does not exist: ${operation.sourcePath}.`);
    }
    const replacesCanonicalTarget =
      direction === "forward" &&
      replacement !== null &&
      operation.targetPath === replacement.targetPath;
    if (io.exists(operation.targetPath) && !replacesCanonicalTarget) {
      throw new Error(`Target already exists: ${operation.targetPath}.`);
    }
    if (replacesCanonicalTarget) {
      validateExistingCanonicalTarget(replacement, io);
    }
    const evidence = evidenceById.get(operation.evidenceId);
    const baseBytes = completedBytes;
    const verified = validateFileEvidence(operation.sourcePath, evidence, io, {
      onDigestProgress: (currentBytes) => {
        publishProgress({
          completedBytes: baseBytes + Math.min(currentBytes, evidence.size),
        });
      },
      requireVerificationCache: options.requireVerificationCache,
      verificationCache: options.verificationCache,
    });
    if (verified.cacheHit) {
      cacheHitCount += 1;
    } else {
      hashedItemCount += 1;
    }
    completedItems += 1;
    completedBytes += evidence.size;
    publishProgress({ completedBytes });
    const sourceDevice = io.stat(operation.sourcePath).dev;
    const targetDevice = io.nearestExistingDevice(operation.targetPath);
    if (`${sourceDevice}` !== `${targetDevice}`) {
      throw new Error(`Local move crosses filesystems: ${operation.targetPath}.`);
    }
  }
  return {
    cacheHitCount,
    completedBytes,
    hashedItemCount,
    operationCount: operations.length,
    serviceStopped: !io.isTrimMediaRunning(),
    state: "preflight-passed",
    totalBytes,
  };
}

export function executeLocalManifest(plan, options = {}) {
  const direction = options.direction ?? "forward";
  const execute = options.execute === true;
  const io = options.io ?? defaultIo;
  const replacement = canonicalReplacementContext(
    plan,
    options.replacementBackup,
    io,
  );
  const legacyCombinedPlan = plan?.execution?.phase === undefined;
  if (legacyCombinedPlan && direction !== "inverse") {
    throw new Error("A legacy combined plan is rollback-only.");
  }
  validateLocalExecutionPlan(plan);
  const journal =
    options.journal ??
    (execute || legacyCombinedPlan
      ? createFileJournal(plan)
      : {
          append() {},
          hasCommitted() {
            return false;
          },
        });

  if (
    legacyCombinedPlan &&
    !journal.hasCommitted(plan.execution.replayKey, "forward")
  ) {
    throw new Error("Legacy local rollback requires a committed forward journal.");
  }

  if (execute && journal.hasCommitted(plan.execution.replayKey, direction)) {
    throw new Error(`Replay key already committed for local ${direction}.`);
  }
  if (execute) journal.acquire?.();
  try {
    if (execute && journal.hasCommitted(plan.execution.replayKey, direction)) {
      throw new Error(`Replay key already committed for local ${direction}.`);
    }
    const preview = preflightLocal(plan, direction, io, options);
    if (!execute) return preview;
    if (!preview.serviceStopped) {
      throw new Error("trim.media must be stopped before local manifest execution.");
    }

    const operations = plan.manifests.local[direction];
    const completed = [];
    journal.append({
      direction,
      manifestSha256:
        plan.execution.manifestSha256[direction === "forward" ? "localForward" : "localInverse"],
      operationCount: operations.length,
      planSha256: sha256(plan),
      replayKey: plan.execution.replayKey,
      state: "prepared",
      timestamp: new Date().toISOString(),
      workItemId: plan.workItemId,
    });

    try {
      const evidenceById = new Map(
        plan.sourceEvidence.map((evidence) => [evidence.evidenceId, evidence]),
      );
      for (const operation of operations) {
        const before = io.stat(operation.sourcePath);
        io.ensureParent(operation.targetPath);
        io.rename(operation.sourcePath, operation.targetPath);
        completed.push(operation);
        const after = io.stat(operation.targetPath);
        if (
          io.exists(operation.sourcePath) ||
          !io.exists(operation.targetPath) ||
          !sameRenameIdentity(before, after)
        ) {
          throw new Error(
            `Local rename identity changed for ${operation.evidenceId}.`,
          );
        }
        options.verificationCache?.record(
          operation.targetPath,
          evidenceById.get(operation.evidenceId),
          after,
        );
      }
      for (const operation of operations) {
        validateFileEvidence(
          operation.targetPath,
          evidenceById.get(operation.evidenceId),
          io,
          {
            requireVerificationCache:
              options.verificationCache !== undefined,
            verificationCache: options.verificationCache,
          },
        );
      }
      if (direction === "inverse" && replacement) {
        restoreExistingCanonicalTarget(replacement, io);
      }
      journal.append({
        direction,
        operationCount: completed.length,
        replayKey: plan.execution.replayKey,
        state: "committed",
        timestamp: new Date().toISOString(),
        workItemId: plan.workItemId,
      });
      return { operationCount: completed.length, state: "committed" };
    } catch (error) {
      journal.append({
        direction,
        operationCount: completed.length,
        replayKey: plan.execution.replayKey,
        state: "rolling-back",
        timestamp: new Date().toISOString(),
        workItemId: plan.workItemId,
      });
      try {
        for (const operation of completed.reverse()) {
          if (!io.exists(operation.targetPath) || io.exists(operation.sourcePath)) {
            throw new Error(`Rollback precondition changed for ${operation.evidenceId}.`);
          }
          const before = io.stat(operation.targetPath);
          io.ensureParent(operation.sourcePath);
          io.rename(operation.targetPath, operation.sourcePath);
          const after = io.stat(operation.sourcePath);
          if (!sameRenameIdentity(before, after)) {
            throw new Error(
              `Rollback rename identity changed for ${operation.evidenceId}.`,
            );
          }
          options.verificationCache?.record(
            operation.sourcePath,
            evidenceById.get(operation.evidenceId),
            after,
          );
        }
        if (direction === "forward" && replacement) {
          restoreExistingCanonicalTarget(replacement, io);
        }
      } catch (rollbackError) {
        journal.append({
          direction,
          error: String(rollbackError),
          replayKey: plan.execution.replayKey,
          state: "rollback-failed",
          timestamp: new Date().toISOString(),
          workItemId: plan.workItemId,
        });
        throw new Error(
          `Local execution failed and rollback failed: ${String(error)}; ${String(rollbackError)}`,
        );
      }
      journal.append({
        direction,
        replayKey: plan.execution.replayKey,
        state: "rolled-back",
        timestamp: new Date().toISOString(),
        workItemId: plan.workItemId,
      });
      throw new Error(`Local manifest rolled back after execution failure: ${String(error)}`);
    }
  } finally {
    if (execute) journal.release?.();
  }
}

function cloudOperations(plan, direction) {
  if (direction === "forward") {
    return [
      ...plan.manifests.cloudVideo.forward,
      ...plan.manifests.cloudSidecarQuarantine.forward,
    ];
  }
  if (direction === "inverse") {
    return [
      ...plan.manifests.cloudSidecarQuarantine.inverse,
      ...plan.manifests.cloudVideo.inverse,
    ];
  }
  throw new Error("Direction must be forward or inverse.");
}

function emitProgress(onProgress, event) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress(event);
  } catch {
    // 进度输出是旁路遥测，绝不能改变或回滚已经执行的数据事务。
  }
}

function validateRemoteFileEvidence(filePath, evidence, cloudIo, options = {}) {
  const actual = cloudIo.stat(filePath);
  if (!actual.isFile) throw new Error(`Cloud source is not a regular file: ${filePath}.`);
  if (actual.size !== evidence.size) {
    throw new Error(`Cloud source size changed for ${evidence.evidenceId}.`);
  }
  if (
    options.checkMtime !== false &&
    Math.trunc(actual.mtimeMs / 1000) !== Math.trunc(evidence.mtimeMs / 1000)
  ) {
    throw new Error(`Cloud source mtime changed for ${evidence.evidenceId}.`);
  }
}

function preflightCloudOperation(operation, evidence, cloudIo, localIo, options = {}) {
  if (operation.operation === "move") {
    if (!cloudIo.exists(operation.sourcePath)) {
      throw new Error(`Cloud source does not exist: ${operation.sourcePath}.`);
    }
    if (cloudIo.exists(operation.targetPath)) {
      throw new Error(`Cloud target already exists: ${operation.targetPath}.`);
    }
    cloudIo.assertMoveReady?.(operation.sourcePath, operation.targetPath);
    validateRemoteFileEvidence(operation.sourcePath, evidence, cloudIo, {
      checkMtime: options.allowProviderMtimeRewrite !== true,
    });
    return;
  }
  if (operation.operation === "upload") {
    if (!localIo.exists(operation.sourcePath)) {
      throw new Error(`Local upload source does not exist: ${operation.sourcePath}.`);
    }
    if (cloudIo.exists(operation.targetPath)) {
      throw new Error(`Cloud target already exists: ${operation.targetPath}.`);
    }
    validateFileEvidence(operation.sourcePath, evidence, localIo);
    return;
  }
  if (operation.operation === "remove-upload") {
    if (!cloudIo.exists(operation.sourcePath)) {
      throw new Error(`Uploaded cloud source does not exist: ${operation.sourcePath}.`);
    }
    if (!localIo.exists(operation.targetPath)) {
      throw new Error(`Upload rollback source does not exist: ${operation.targetPath}.`);
    }
    validateRemoteFileEvidence(operation.sourcePath, evidence, cloudIo, {
      checkMtime: false,
    });
    validateFileEvidence(operation.targetPath, evidence, localIo);
    return;
  }
  throw new Error(`Unsupported cloud operation: ${operation.operation}.`);
}

function preflightCloud(plan, direction, cloudIo, localIo, options = {}) {
  const { evidenceById } = validateCloudExecutionPlan(plan, {
    allowLegacyRollback: options.allowLegacyRollback,
  });
  cloudIo.assertTransport?.();
  const operations = cloudOperations(plan, direction);
  for (const operation of operations) {
    const evidence = evidenceById.get(operation.evidenceId);
    preflightCloudOperation(operation, evidence, cloudIo, localIo, options);
  }
  return {
    operationCount: operations.length,
    state: "preflight-passed",
  };
}

function applyCloudOperation(operation, cloudIo, localIo) {
  if (operation.operation !== "remove-upload") {
    cloudIo.ensureParent?.(operation.targetPath);
  }
  if (operation.operation === "move") {
    cloudIo.move(operation.sourcePath, operation.targetPath);
  } else if (operation.operation === "upload") {
    cloudIo.upload(operation.sourcePath, operation.targetPath, localIo);
  } else if (operation.operation === "remove-upload") {
    cloudIo.remove(operation.sourcePath);
  } else {
    throw new Error(`Unsupported cloud operation: ${operation.operation}.`);
  }
}

function verifyAppliedCloudOperation(operation, evidence, cloudIo, localIo) {
  if (operation.operation === "move") {
    if (cloudIo.exists(operation.sourcePath)) {
      throw new Error(`Cloud move source still exists: ${operation.sourcePath}.`);
    }
    validateRemoteFileEvidence(operation.targetPath, evidence, cloudIo, {
      checkMtime: false,
    });
  } else if (operation.operation === "upload") {
    validateFileEvidence(operation.sourcePath, evidence, localIo);
    validateRemoteFileEvidence(operation.targetPath, evidence, cloudIo, {
      checkMtime: false,
    });
  } else if (operation.operation === "remove-upload") {
    if (cloudIo.exists(operation.sourcePath)) {
      throw new Error(`Cloud upload target still exists: ${operation.sourcePath}.`);
    }
    validateFileEvidence(operation.targetPath, evidence, localIo);
  }
}

function rollbackCloudOperation(operation, evidence, cloudIo, localIo) {
  if (operation.operation === "move") {
    if (!cloudIo.exists(operation.targetPath) || cloudIo.exists(operation.sourcePath)) {
      throw new Error(`Cloud rollback precondition changed for ${operation.evidenceId}.`);
    }
    cloudIo.move(operation.targetPath, operation.sourcePath);
    validateRemoteFileEvidence(operation.sourcePath, evidence, cloudIo, {
      checkMtime: false,
    });
  } else if (operation.operation === "upload") {
    if (!cloudIo.exists(operation.targetPath)) {
      throw new Error(`Cloud upload rollback target is missing: ${operation.targetPath}.`);
    }
    cloudIo.remove(operation.targetPath);
    if (cloudIo.exists(operation.targetPath)) {
      throw new Error(`Cloud upload rollback did not remove ${operation.targetPath}.`);
    }
  } else if (operation.operation === "remove-upload") {
    if (cloudIo.exists(operation.sourcePath) || !localIo.exists(operation.targetPath)) {
      throw new Error(`Cloud inverse rollback precondition changed for ${operation.evidenceId}.`);
    }
    cloudIo.upload(operation.targetPath, operation.sourcePath, localIo);
    validateRemoteFileEvidence(operation.sourcePath, evidence, cloudIo, {
      checkMtime: false,
    });
  }
}

function reconcileFailedCloudOperation(operation, evidence, cloudIo, localIo, options = {}) {
  try {
    verifyAppliedCloudOperation(operation, evidence, cloudIo, localIo);
    return "applied";
  } catch {
    try {
      preflightCloudOperation(operation, evidence, cloudIo, localIo, options);
      return "not-applied";
    } catch {
      throw new Error(`Cloud operation state is ambiguous for ${operation.evidenceId}.`);
    }
  }
}

export function executeCloudManifest(plan, options = {}) {
  const direction = options.direction ?? "forward";
  const execute = options.execute === true;
  const localIo = options.localIo ?? defaultIo;
  const legacyCombinedPlan = plan?.execution?.phase === undefined;
  if (legacyCombinedPlan && direction !== "inverse") {
    throw new Error("A legacy combined plan is rollback-only.");
  }
  validateCloudExecutionPlan(plan, { allowLegacyRollback: legacyCombinedPlan });
  const ownsCloudIo = options.cloudIo === undefined;
  const cloudIo = options.cloudIo ?? createDefaultCloudIo(plan, options.password);
  const journal = options.journal ?? createFileJournal(plan, "cloud");

  if (
    legacyCombinedPlan &&
    !journal.hasCommitted(plan.execution.replayKey, "forward")
  ) {
    throw new Error("Legacy cloud rollback requires a committed forward journal.");
  }

  if (execute && journal.hasCommitted(plan.execution.replayKey, direction)) {
    throw new Error(`Replay key already committed for cloud ${direction}.`);
  }
  if (execute) journal.acquire?.();
  try {
    if (execute && journal.hasCommitted(plan.execution.replayKey, direction)) {
      throw new Error(`Replay key already committed for cloud ${direction}.`);
    }
    const preflightOptions = {
      allowLegacyRollback: legacyCombinedPlan,
      allowProviderMtimeRewrite:
        direction === "inverse" &&
        journal.hasCommitted(plan.execution.replayKey, "forward"),
    };
    const preview = preflightCloud(
      plan,
      direction,
      cloudIo,
      localIo,
      preflightOptions,
    );
    if (!execute) return preview;

    const { evidenceById } = validateCloudExecutionPlan(plan, {
      allowLegacyRollback: legacyCombinedPlan,
    });
    const operations = cloudOperations(plan, direction);
    const completed = [];
    journal.append({
      direction,
      manifestSha256: {
        sidecar:
          plan.execution.manifestSha256[
            direction === "forward" ? "cloudSidecarForward" : "cloudSidecarInverse"
          ],
        video:
          plan.execution.manifestSha256[
            direction === "forward" ? "cloudVideoForward" : "cloudVideoInverse"
          ],
      },
      operationCount: operations.length,
      planSha256: sha256(plan),
      replayKey: plan.execution.replayKey,
      scope: "cloud",
      state: "prepared",
      timestamp: new Date().toISOString(),
      workItemId: plan.workItemId,
    });
    let activeOperation;
    try {
      for (const operation of operations) {
        activeOperation = operation;
        const evidence = evidenceById.get(operation.evidenceId);
        preflightCloudOperation(
          operation,
          evidence,
          cloudIo,
          localIo,
          preflightOptions,
        );
        applyCloudOperation(operation, cloudIo, localIo);
        verifyAppliedCloudOperation(operation, evidence, cloudIo, localIo);
        completed.push(operation);
        emitProgress(options.onProgress, {
          completed: completed.length,
          direction,
          phase: "applying",
          scope: "cloud",
          total: operations.length,
        });
        activeOperation = undefined;
      }
      cloudIo.refresh?.();
      let verified = 0;
      for (const operation of operations) {
        verifyAppliedCloudOperation(
          operation,
          evidenceById.get(operation.evidenceId),
          cloudIo,
          localIo,
        );
        verified += 1;
        emitProgress(options.onProgress, {
          completed: verified,
          direction,
          phase: "verifying",
          scope: "cloud",
          total: operations.length,
        });
      }
      journal.append({
        direction,
        operationCount: completed.length,
        replayKey: plan.execution.replayKey,
        scope: "cloud",
        state: "committed",
        timestamp: new Date().toISOString(),
        workItemId: plan.workItemId,
      });
      return { operationCount: completed.length, state: "committed" };
    } catch (error) {
      let reconciliationError;
      if (activeOperation) {
        try {
          const reconciliation = reconcileFailedCloudOperation(
            activeOperation,
            evidenceById.get(activeOperation.evidenceId),
            cloudIo,
            localIo,
            preflightOptions,
          );
          if (reconciliation === "applied") completed.push(activeOperation);
        } catch (caught) {
          reconciliationError = caught;
        }
      }
      journal.append({
        direction,
        operationCount: completed.length,
        replayKey: plan.execution.replayKey,
        scope: "cloud",
        state: "rolling-back",
        timestamp: new Date().toISOString(),
        workItemId: plan.workItemId,
      });
      try {
        for (const operation of completed.reverse()) {
          rollbackCloudOperation(
            operation,
            evidenceById.get(operation.evidenceId),
            cloudIo,
            localIo,
          );
        }
        cloudIo.refresh?.();
      } catch (rollbackError) {
        journal.append({
          direction,
          error: String(rollbackError),
          replayKey: plan.execution.replayKey,
          scope: "cloud",
          state: "rollback-failed",
          timestamp: new Date().toISOString(),
          workItemId: plan.workItemId,
        });
        throw new Error(
          `Cloud execution failed and rollback failed: ${String(error)}; ${String(rollbackError)}`,
        );
      }
      if (reconciliationError) {
        journal.append({
          direction,
          error: String(reconciliationError),
          replayKey: plan.execution.replayKey,
          scope: "cloud",
          state: "reconciliation-failed",
          timestamp: new Date().toISOString(),
          workItemId: plan.workItemId,
        });
        throw new Error(
          `Cloud execution stopped with an ambiguous operation state: ${String(error)}; ${String(reconciliationError)}`,
        );
      }
      journal.append({
        direction,
        replayKey: plan.execution.replayKey,
        scope: "cloud",
        state: "rolled-back",
        timestamp: new Date().toISOString(),
        workItemId: plan.workItemId,
      });
      throw new Error(`Cloud manifest rolled back after execution failure: ${String(error)}`);
    }
  } finally {
    if (execute) journal.release?.();
    if (ownsCloudIo) cloudIo.close?.();
  }
}

function digestFile(filePath, method) {
  const file = statSync(filePath);
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  try {
    if (method === "sha256-full-v1") {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let bytesRead;
      let position = 0;
      do {
        bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
        if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      } while (bytesRead > 0);
    } else if (method === "bounded-sha256-first-last-4mib-v1") {
      const firstLength = Math.min(file.size, BOUNDED_CHUNK_BYTES);
      const first = Buffer.allocUnsafe(firstLength);
      if (firstLength > 0) {
        readSync(descriptor, first, 0, firstLength, 0);
        hash.update(first);
      }
      if (file.size > BOUNDED_CHUNK_BYTES) {
        const lastLength = Math.min(file.size - firstLength, BOUNDED_CHUNK_BYTES);
        const last = Buffer.allocUnsafe(lastLength);
        readSync(descriptor, last, 0, lastLength, file.size - lastLength);
        hash.update(last);
      }
    } else {
      throw new Error(`Unsupported local digest method: ${method}.`);
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

/**
 * 将 bigint 文件状态无损投影为执行器 I/O 合同，保留 inode、ctime、mtime 与链接数的十进制文本。
 * @param {import("node:fs").BigIntStats} stat - 同一已打开文件描述符或 lstat 返回的 bigint 状态。
 * @returns {object} 可用于密封比较且大小仍为安全整数的本地文件状态。
 * @throws 当文件大小超出 JSON 安全整数范围时抛出。
 */
function projectLocalFileStat(stat) {
  const size = Number(stat.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("local-file-size-unsafe");
  }
  return {
    ctimeNs: stat.ctimeNs.toString(),
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    isFile: stat.isFile(),
    mtimeMs: Number(stat.mtimeNs / 1_000_000n),
    mtimeNs: stat.mtimeNs.toString(),
    nlink: stat.nlink.toString(),
    size,
  };
}

/**
 * 通过 O_NOFOLLOW 打开同一文件描述符计算摘要，并在固定字节间隔发布心跳且要求前后 fstat 完全一致。
 * @param {string} filePath - 需要完整或有界摘要验证的本地普通文件。
 * @param {string} method - 密封证据声明的摘要算法。
 * @param {(bytes:number)=>void} [onBytes] - 当前文件已读取字节的脱敏进度回调。
 * @returns {{after:object,before:object,digest:string}} 同 fd 摘要与前后稳定身份。
 * @throws 当符号链接、算法、读取或哈希期间身份漂移时抛出。
 */
function verifyFileDigest(filePath, method, onBytes) {
  const descriptor = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = projectLocalFileStat(fstatSync(descriptor, { bigint: true }));
    if (!before.isFile) {
      throw new Error(`Source is not a regular file: ${filePath}.`);
    }
    const hash = createHash("sha256");
    let processed = 0;
    let nextProgress = VERIFICATION_PROGRESS_BYTES;
    const publishBytes = () => {
      if (typeof onBytes === "function") onBytes(processed);
    };
    if (method === "sha256-full-v1") {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      while (true) {
        const bytesRead = readSync(
          descriptor,
          buffer,
          0,
          buffer.length,
          processed,
        );
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
        processed += bytesRead;
        if (processed >= nextProgress) {
          publishBytes();
          nextProgress = processed + VERIFICATION_PROGRESS_BYTES;
        }
      }
    } else if (method === "bounded-sha256-first-last-4mib-v1") {
      const firstLength = Math.min(before.size, BOUNDED_CHUNK_BYTES);
      const first = Buffer.allocUnsafe(firstLength);
      if (firstLength > 0) {
        readSync(descriptor, first, 0, firstLength, 0);
        hash.update(first);
        processed += firstLength;
      }
      if (before.size > BOUNDED_CHUNK_BYTES) {
        const lastLength = Math.min(
          before.size - firstLength,
          BOUNDED_CHUNK_BYTES,
        );
        const last = Buffer.allocUnsafe(lastLength);
        readSync(
          descriptor,
          last,
          0,
          lastLength,
          before.size - lastLength,
        );
        hash.update(last);
        processed += lastLength;
      }
    } else {
      throw new Error(`Unsupported local digest method: ${method}.`);
    }
    publishBytes();
    const after = projectLocalFileStat(fstatSync(descriptor, { bigint: true }));
    if (!sameVerificationIdentity(before, after)) {
      throw new Error(`Source changed while hashing ${filePath}.`);
    }
    return { after, before, digest: hash.digest("hex") };
  } finally {
    closeSync(descriptor);
  }
}

function nearestExistingDevice(candidate) {
  let current = path.posix.dirname(candidate);
  while (!existsSync(current)) {
    const parent = path.posix.dirname(current);
    if (parent === current) throw new Error(`No existing parent for ${candidate}.`);
    current = parent;
  }
  return statSync(current).dev;
}

function isTrimMediaRunning() {
  for (const entry of readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const command = readFileSync(`/proc/${entry.name}/cmdline`, "utf8").replaceAll("\0", " ");
      if (command.includes("/@appcenter/trim.media/trim-media")) return true;
    } catch {
      // Processes may exit while /proc is being inspected.
    }
  }
  return false;
}

const defaultIo = {
  digest: digestFile,
  ensureParent(targetPath) {
    mkdirSync(path.posix.dirname(targetPath), { mode: 0o750, recursive: true });
  },
  exists: existsSync,
  isTrimMediaRunning,
  link: linkSync,
  nearestExistingDevice,
  rename: renameSync,
  stat(filePath) {
    return projectLocalFileStat(lstatSync(filePath, { bigint: true }));
  },
  verify: verifyFileDigest,
};

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function createDefaultCloudIo(plan, password) {
  if (plan.execution.cloudTransport.type === "rclone-webdav") {
    throw new Error(
      "rclone-webdav cloud mutation is disabled after an ambiguous MOVE; reseal with alist-native-api.",
    );
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("AList native API execution requires a password supplied through standard input.");
  }
  return createAlistNativeCloudIo(plan, password);
}

function createAlistNativeCloudIo(plan, initialPassword) {
  const transport = plan.execution.cloudTransport;
  const storageRoot = transport.storageRoot;
  const ensuredDirectories = new Set();
  const files = new Map();
  const missingDirectories = new Set();
  const plannedDirectories = new Set(
    [
      ...plan.manifests.cloudVideo.forward,
      ...plan.manifests.cloudSidecarQuarantine.forward,
    ].flatMap((operation) =>
      [operation.sourcePath, operation.targetPath]
        .filter((candidate) => candidate.startsWith("/Media/"))
        .map((candidate) => path.posix.dirname(candidate)),
    ),
  );
  const refreshedDirectories = new Set();
  let password = initialPassword;
  let token;

  function runHelper(request, timeout = 60_000) {
    if (!existsSync(ALIST_HELPER_PATH)) {
      throw new Error(`AList native API helper does not exist: ${ALIST_HELPER_PATH}.`);
    }
    const result = spawnSync("python3", [ALIST_HELPER_PATH], {
      encoding: "utf8",
      input: JSON.stringify(request),
      maxBuffer: 16 * 1024 * 1024,
      timeout,
    });
    if (result.error) {
      throw new Error(`AList API helper failed to start or timed out: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `AList API helper exited ${result.status}: ${`${result.stderr ?? ""}`.trim() || "no diagnostic"}`,
      );
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error("AList API helper returned invalid JSON.");
    }
  }

  function api(route, body, options = {}) {
    return runHelper(
      {
        action: "json",
        baseUrl: transport.apiBase,
        body,
        method: options.method ?? "POST",
        route,
        timeoutSeconds: options.timeoutSeconds ?? 30,
        token: options.anonymous ? undefined : token,
      },
      (options.timeoutSeconds ?? 30) * 1_000 + 5_000,
    );
  }

  function requireSuccess(result, label) {
    if (result.http !== 200 || result.payload?.code !== 200) {
      const code = result.payload?.code ?? result.http;
      const message = result.payload?.message ?? "unknown";
      throw new Error(`${label} failed with code ${code}: ${message}`);
    }
    return result.payload;
  }

  function isNotFound(result) {
    return (
      result.http === 200 &&
      result.payload?.code === 500 &&
      /(?:object|file|path).*(?:not found|not exist)|(?:not found|not exist)/i.test(
        result.payload?.message ?? "",
      )
    );
  }

  function fileMetadata(data, filePath) {
    const mtimeMs = Date.parse(data.modified);
    if (!Number.isFinite(data.size) || !Number.isFinite(mtimeMs)) {
      throw new Error(`AList returned invalid file metadata for ${filePath}.`);
    }
    return {
      isFile: data.is_dir === false,
      mtimeMs,
      size: data.size,
    };
  }

  function refreshDirectory(directory) {
    for (const candidate of files.keys()) {
      if (path.posix.dirname(candidate) === directory) files.delete(candidate);
    }
    const result = api("/api/fs/list", {
      page: 1,
      password: "",
      path: directory,
      per_page: 1_000,
      refresh: true,
    });
    if (isNotFound(result)) {
      missingDirectories.add(directory);
      refreshedDirectories.add(directory);
      return;
    }
    const payload = requireSuccess(result, `AList refresh ${directory}`);
    const rawContent = payload.data?.content;
    const content = rawContent === null || rawContent === undefined ? [] : rawContent;
    if (!Array.isArray(content)) {
      throw new Error(`AList refresh returned invalid content for ${directory}.`);
    }
    const total = payload.data?.total;
    if (Number.isFinite(total) && total > content.length) {
      throw new Error(`AList refresh exceeded the 1000-entry bound for ${directory}.`);
    }
    for (const item of content) {
      const candidate = path.posix.join(directory, item.name);
      files.set(candidate, fileMetadata(item, candidate));
    }
    missingDirectories.delete(directory);
    refreshedDirectories.add(directory);
  }

  function refreshAll() {
    files.clear();
    missingDirectories.clear();
    refreshedDirectories.clear();
    for (const directory of plannedDirectories) refreshDirectory(directory);
  }

  function readFresh(filePath) {
    files.delete(filePath);
    const result = api("/api/fs/get", { password: "", path: filePath });
    if (result.http === 200 && result.payload?.code === 200) {
      const data = result.payload.data ?? {};
      const file = fileMetadata(data, filePath);
      files.set(filePath, file);
      return file;
    }
    if (isNotFound(result)) {
      files.set(filePath, null);
      return null;
    }
    requireSuccess(result, `AList stat ${filePath}`);
  }

  function cached(filePath) {
    if (files.has(filePath)) return files.get(filePath);
    if (refreshedDirectories.has(path.posix.dirname(filePath))) return null;
    return readFresh(filePath);
  }

  function waitForPath(filePath, predicate, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let file;
    do {
      refreshDirectory(path.posix.dirname(filePath));
      file = files.get(filePath) ?? null;
      if (predicate(file)) return file;
      if (Date.now() < deadline) sleepSync(2_000);
    } while (Date.now() < deadline);
    return file;
  }

  function snapshotMove(source, interim, target) {
    const paths = [...new Set([source, interim, target])];
    for (const directory of new Set(paths.map((candidate) => path.posix.dirname(candidate)))) {
      refreshDirectory(directory);
    }
    const state = new Map(
      paths.map((candidate) => [candidate, files.get(candidate) ?? null]),
    );
    return {
      interim: state.get(interim),
      source: state.get(source),
      target: state.get(target),
    };
  }

  function movedStateMatches(state, expected, interimIsTarget = false) {
    return (
      !state.source &&
      (interimIsTarget || !state.interim) &&
      state.target?.isFile === true &&
      state.target.size === expected.size
    );
  }

  function originalStateMatches(state, expected, interimIsSource = false) {
    return (
      state.source?.isFile === true &&
      state.source.size === expected.size &&
      (interimIsSource || !state.interim) &&
      !state.target
    );
  }

  function intermediateStateMatches(state, expected, interimIsSource, interimIsTarget) {
    return (
      !interimIsSource &&
      !interimIsTarget &&
      !state.source &&
      state.interim?.isFile === true &&
      state.interim.size === expected.size &&
      !state.target
    );
  }

  function classifyMoveState(state, expected, interimIsSource, interimIsTarget) {
    for (const file of [state.source, state.interim, state.target]) {
      if (file && (!file.isFile || file.size !== expected.size)) return "invalid";
    }
    if (movedStateMatches(state, expected, interimIsTarget)) return "moved";
    if (originalStateMatches(state, expected, interimIsSource)) return "original";
    if (
      intermediateStateMatches(
        state,
        expected,
        interimIsSource,
        interimIsTarget,
      )
    ) {
      return "intermediate";
    }
    return "pending";
  }

  function waitForMoveState(
    source,
    interim,
    target,
    expected,
    accepted,
    timeoutMs = 180_000,
  ) {
    const interimIsSource = interim === source;
    const interimIsTarget = interim === target;
    const deadline = Date.now() + timeoutMs;
    let state;
    let classification;
    do {
      state = snapshotMove(source, interim, target);
      classification = classifyMoveState(
        state,
        expected,
        interimIsSource,
        interimIsTarget,
      );
      if (accepted.has(classification) || classification === "invalid") {
        return { classification, state };
      }
      if (Date.now() < deadline) sleepSync(2_000);
    } while (Date.now() < deadline);
    return { classification, state };
  }

  function callMove(source, targetDirectory) {
    return requireSuccess(
      api(
        "/api/fs/move",
        {
          dst_dir: targetDirectory,
          names: [path.posix.basename(source)],
          src_dir: path.posix.dirname(source),
        },
        { timeoutSeconds: 120 },
      ),
      `AList move ${source}`,
    );
  }

  function callRename(source, targetName) {
    return requireSuccess(
      api(
        "/api/fs/rename",
        { name: targetName, path: source },
        { timeoutSeconds: 120 },
      ),
      `AList rename ${source}`,
    );
  }

  function move(source, target) {
    const expected = cached(source);
    if (!expected?.isFile) throw new Error(`Cloud move source is missing: ${source}.`);
    const sourceDirectory = path.posix.dirname(source);
    const targetDirectory = path.posix.dirname(target);
    const sourceName = path.posix.basename(source);
    const targetName = path.posix.basename(target);
    const interim = path.posix.join(targetDirectory, sourceName);
    const interimIsSource = interim === source;
    const interimIsTarget = interim === target;

    if (sourceDirectory !== targetDirectory) {
      let moveError;
      try {
        callMove(source, targetDirectory);
      } catch (error) {
        moveError = error;
      }
      const transition = waitForMoveState(
        source,
        interim,
        target,
        expected,
        new Set(["intermediate", "moved"]),
      );
      if (transition.classification === "moved") return;
      if (transition.classification === "original") {
        throw moveError ?? new Error(`AList move did not change ${source}.`);
      }
      if (transition.classification !== "intermediate") {
        throw new Error(`AList move entered an ambiguous intermediate state for ${source}.`);
      }
    }

    if (sourceName === targetName) {
      const transition = waitForMoveState(
        source,
        interim,
        target,
        expected,
        new Set(["moved"]),
      );
      if (transition.classification === "moved") return;
      throw new Error(`AList move postcondition failed for ${target}.`);
    }

    let renameError;
    try {
      callRename(interim, targetName);
    } catch (error) {
      renameError = error;
    }
    let transition = waitForMoveState(
      source,
      interim,
      target,
      expected,
      new Set(["moved"]),
    );
    if (transition.classification === "moved") return;
    if (sourceDirectory === targetDirectory && transition.classification === "original") {
      throw renameError ?? new Error(`AList rename did not change ${source}.`);
    }
    if (transition.classification === "intermediate") {
      if (sourceDirectory === targetDirectory) {
        throw renameError ?? new Error(`AList rename did not change ${interim}.`);
      }
      let rollbackError;
      try {
        callMove(interim, sourceDirectory);
      } catch (error) {
        rollbackError = error;
      }
      transition = waitForMoveState(
        source,
        interim,
        target,
        expected,
        new Set(["original"]),
      );
      if (transition.classification === "original") {
        throw renameError ?? new Error(`AList rename failed and its move was rolled back.`);
      }
      throw new Error(
        `AList rename rollback failed for ${source}: ${String(renameError)}; ${String(rollbackError)}`,
      );
    }
    throw new Error(`AList rename entered an ambiguous state for ${source}.`);
  }

  return {
    assertMoveReady(source, target) {
      const interim = path.posix.join(
        path.posix.dirname(target),
        path.posix.basename(source),
      );
      if (interim !== source && interim !== target && cached(interim)) {
        throw new Error(`Cloud move intermediate target already exists: ${interim}.`);
      }
    },
    assertTransport() {
      if (!token) {
        const result = runHelper({
          action: "json",
          baseUrl: transport.apiBase,
          body: { password, username: transport.username },
          method: "POST",
          route: "/api/auth/login",
          timeoutSeconds: 15,
        });
        password = "";
        const payload = requireSuccess(result, "AList login");
        token = payload.data?.token;
        if (typeof token !== "string" || token.length === 0) {
          throw new Error("AList login succeeded without a token.");
        }
      }
      refreshAll();
    },
    close() {
      password = "";
      if (!token) return;
      try {
        api("/api/auth/logout", undefined, { method: "GET", timeoutSeconds: 10 });
      } finally {
        token = undefined;
        files.clear();
        missingDirectories.clear();
        refreshedDirectories.clear();
      }
    },
    ensureParent(target) {
      const directory = path.posix.dirname(target);
      if (ensuredDirectories.has(directory)) return;
      if (!isInsideRoot(storageRoot, directory)) {
        throw new Error(`AList target parent is outside ${storageRoot}: ${directory}.`);
      }
      let current = storageRoot;
      ensuredDirectories.add(current);
      for (const segment of path.posix.relative(storageRoot, directory).split("/")) {
        current = path.posix.join(current, segment);
        if (ensuredDirectories.has(current)) continue;
        refreshDirectory(path.posix.dirname(current));
        const existing = files.get(current) ?? null;
        if (existing) {
          if (existing.isFile) {
            throw new Error(`AList target parent is not a directory: ${current}.`);
          }
        } else {
          requireSuccess(
            api("/api/fs/mkdir", { path: current }),
            `AList mkdir ${current}`,
          );
          const created = waitForPath(
            current,
            (candidate) => candidate !== null,
            60_000,
          );
          if (!created || created.isFile) {
            throw new Error(`AList mkdir postcondition failed for ${current}.`);
          }
        }
        ensuredDirectories.add(current);
      }
    },
    exists(filePath) {
      return cached(filePath) !== null;
    },
    move,
    refresh() {
      refreshAll();
    },
    remove(filePath) {
      let removeError;
      try {
        requireSuccess(
          api(
            "/api/fs/remove",
            {
              dir: path.posix.dirname(filePath),
              names: [path.posix.basename(filePath)],
            },
            { timeoutSeconds: 120 },
          ),
          `AList remove ${filePath}`,
        );
      } catch (error) {
        removeError = error;
      }
      if (waitForPath(filePath, (candidate) => candidate === null) === null) return;
      throw removeError ?? new Error(`AList remove postcondition failed for ${filePath}.`);
    },
    stat(filePath) {
      const file = cached(filePath);
      if (!file) throw new Error(`Cloud stat source is missing: ${filePath}.`);
      return file;
    },
    upload(source, target, localIo) {
      const expected = localIo.stat(source);
      let uploadError;
      try {
        const result = runHelper(
          {
            action: "upload",
            baseUrl: transport.apiBase,
            sourcePath: source,
            targetPath: target,
            timeoutSeconds: 3600,
            token,
          },
          3_700_000,
        );
        requireSuccess(result, `AList upload ${target}`);
      } catch (error) {
        uploadError = error;
      }
      const uploaded = waitForPath(
        target,
        (candidate) => candidate !== null,
        300_000,
      );
      if (!uploaded) {
        throw uploadError ?? new Error(`AList upload did not become visible within 300 seconds: ${target}.`);
      }
      if (!uploaded.isFile || uploaded.size !== expected.size) {
        throw new Error(`AList upload target size changed for ${target}.`);
      }
    },
  };
}

function createFileJournal(plan, scope = "local") {
  const baseName = `${plan.execution.replayKey}.${scope}`;
  const journalPath = path.posix.join(DEFAULT_JOURNAL_ROOT, `${baseName}.jsonl`);
  const lockPath = path.posix.join(DEFAULT_JOURNAL_ROOT, `${baseName}.lock`);
  let lockDescriptor;
  return {
    acquire() {
      mkdirSync(DEFAULT_JOURNAL_ROOT, { mode: 0o700, recursive: true });
      try {
        lockDescriptor = openSync(
          lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        writeSync(lockDescriptor, `${process.pid}\n`);
        fsyncSync(lockDescriptor);
      } catch (error) {
        throw new Error(`Local media executor lock is already held: ${String(error)}`);
      }
    },
    append(entry) {
      mkdirSync(DEFAULT_JOURNAL_ROOT, { mode: 0o700, recursive: true });
      const descriptor = openSync(
        journalPath,
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY,
        0o600,
      );
      try {
        writeSync(descriptor, `${JSON.stringify(entry)}\n`);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    },
    hasCommitted(_replayKey, direction) {
      if (!existsSync(journalPath)) return false;
      return readFileSync(journalPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .some((line) => {
          const entry = JSON.parse(line);
          return entry.direction === direction && entry.state === "committed";
        });
    },
    release() {
      if (lockDescriptor !== undefined) {
        closeSync(lockDescriptor);
        lockDescriptor = undefined;
        unlinkSync(lockPath);
      }
    },
  };
}

function readOption(argv, name) {
  const keyValue = argv.find((item) => item.startsWith(`${name}=`));
  if (keyValue) return keyValue.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function runCli() {
  const planPath = readOption(process.argv, "--plan");
  const direction = readOption(process.argv, "--direction") ?? "forward";
  const scope = readOption(process.argv, "--scope") ?? "local";
  const verificationCacheRoot = readOption(
    process.argv,
    "--verification-cache-root",
  );
  const verificationAttemptId = readOption(
    process.argv,
    "--verification-attempt-id",
  );
  const verificationToolSha256 = readOption(
    process.argv,
    "--verification-tool-sha256",
  );
  const replacementBackupPath = readOption(
    process.argv,
    "--replacement-backup-evidence",
  );
  const replacementBackupSha256 = readOption(
    process.argv,
    "--replacement-backup-evidence-sha256",
  );
  const requireVerificationCache = process.argv.includes(
    "--require-verification-cache",
  );
  const execute = process.argv.includes("--execute");
  const passwordFromStdin = process.argv.includes("--alist-password-stdin");
  if (!planPath || !["cloud", "local"].includes(scope)) {
    throw new Error(
      "Usage: media-manifest-executor.mjs --plan <file> [--scope local|cloud] [--direction forward|inverse] [--alist-password-stdin] [--execute]",
    );
  }
  if (execute && typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error("Media manifest execution requires root.");
  }
  if (scope === "cloud" && !passwordFromStdin) {
    throw new Error("Cloud execution requires --alist-password-stdin.");
  }
  if (
    scope === "cloud" &&
    (verificationCacheRoot || requireVerificationCache || replacementBackupPath)
  ) {
    throw new Error("Cloud execution cannot use the local verification cache.");
  }
  if (requireVerificationCache && !verificationCacheRoot) {
    throw new Error("Required local verification cache root is missing.");
  }
  if (
    verificationToolSha256 &&
    (!DIGEST_PATTERN.test(verificationToolSha256) ||
      digestFile(fileURLToPath(import.meta.url), "sha256-full-v1") !==
        verificationToolSha256)
  ) {
    throw new Error("Verification tool SHA-256 changed.");
  }
  let password;
  if (scope === "cloud") {
    password = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  let replacementBackup;
  if (replacementBackupPath || replacementBackupSha256) {
    if (
      !replacementBackupPath ||
      !replacementBackupSha256 ||
      !path.posix.isAbsolute(replacementBackupPath) ||
      !isInsideRoot(EVIDENCE_ROOT, replacementBackupPath) ||
      !DIGEST_PATTERN.test(replacementBackupSha256) ||
      digestFile(replacementBackupPath, "sha256-full-v1") !==
        replacementBackupSha256
    ) {
      throw new Error("Canonical replacement backup identity changed.");
    }
    replacementBackup = readPrivateJson(replacementBackupPath);
  }
  let verificationCache;
  if (scope === "local" && verificationCacheRoot) {
    verificationCache = createFileVerificationCache(
      verificationCacheRoot,
      plan,
      {
        attemptId: verificationAttemptId,
        verifierSha256: verificationToolSha256,
      },
    );
  }
  let onProgress;
  if (execute) {
    onProgress = (event) => {
      if (event.completed % 25 !== 0 && event.completed !== event.total) return;
      process.stderr.write(`${JSON.stringify(event)}\n`);
    };
  }
  let result;
  if (scope === "cloud") {
    result = executeCloudManifest(plan, {
      direction,
      execute,
      onProgress,
      password,
    });
  } else {
    result = executeLocalManifest(plan, {
      direction,
      execute,
      replacementBackup,
      requireVerificationCache,
      verificationCache,
    });
  }
  process.stdout.write(`${JSON.stringify({ direction, execute, scope, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
