export const MEDIA_GOVERNANCE_CANONICAL_REPLACEMENT_SCHEMA =
  'media-canonical-replacement-v1' as const;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/u;

export type MediaGovernanceCanonicalReplacement = {
  replacedPlanSha256: string;
  replacedTaskId: string;
  replacedTaskRevision: number;
  replacedWorkItemId: string;
  schemaVersion: typeof MEDIA_GOVERNANCE_CANONICAL_REPLACEMENT_SCHEMA;
  targetEvidence: {
    digest: string;
    evidenceId: string;
    evidenceMethod: 'sha256-full-v1';
    fileKind: 'video';
    mtimeMs: number;
    path: string;
    scope: 'local';
    size: number;
  };
};

/**
 * 从密封计划读取并严格校验电影规范目标替换合同，未声明替换时返回空值。
 * @param plan - 可能携带 `canonicalReplacement` 的 Schema 1.2.0 密封计划。
 * @returns 已验证的替换合同；普通治理计划返回 `null`。
 * @throws 当替换合同字段、摘要、路径、版本或证据边界不完整时抛出。
 */
export function readMediaGovernanceCanonicalReplacement(
  plan: null | Record<string, unknown>,
): MediaGovernanceCanonicalReplacement | null {
  const value = plan?.canonicalReplacement;
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('canonical-replacement-contract-invalid');
  }
  const replacement = value as Record<string, unknown>;
  const evidenceValue = replacement.targetEvidence;
  if (
    !evidenceValue ||
    typeof evidenceValue !== 'object' ||
    Array.isArray(evidenceValue)
  ) {
    throw new Error('canonical-replacement-evidence-invalid');
  }
  const evidence = evidenceValue as Record<string, unknown>;
  const contractKeys = Object.keys(replacement).sort();
  const expectedContractKeys = [
    'replacedPlanSha256',
    'replacedTaskId',
    'replacedTaskRevision',
    'replacedWorkItemId',
    'schemaVersion',
    'targetEvidence',
  ].sort();
  const evidenceKeys = Object.keys(evidence).sort();
  const expectedEvidenceKeys = [
    'digest',
    'evidenceId',
    'evidenceMethod',
    'fileKind',
    'mtimeMs',
    'path',
    'scope',
    'size',
  ].sort();
  const keysInvalid =
    JSON.stringify(contractKeys) !== JSON.stringify(expectedContractKeys) ||
    JSON.stringify(evidenceKeys) !== JSON.stringify(expectedEvidenceKeys);
  const identityInvalid =
    replacement.schemaVersion !==
      MEDIA_GOVERNANCE_CANONICAL_REPLACEMENT_SCHEMA ||
    typeof replacement.replacedTaskId !== 'string' ||
    !ID_PATTERN.test(replacement.replacedTaskId) ||
    typeof replacement.replacedWorkItemId !== 'string' ||
    !/^media-\d{3}$/u.test(replacement.replacedWorkItemId) ||
    typeof replacement.replacedPlanSha256 !== 'string' ||
    !DIGEST_PATTERN.test(replacement.replacedPlanSha256) ||
    !Number.isInteger(replacement.replacedTaskRevision) ||
    Number(replacement.replacedTaskRevision) < 1;
  const evidenceInvalid =
    typeof evidence.digest !== 'string' ||
    !DIGEST_PATTERN.test(evidence.digest) ||
    typeof evidence.evidenceId !== 'string' ||
    !ID_PATTERN.test(evidence.evidenceId) ||
    evidence.evidenceMethod !== 'sha256-full-v1' ||
    evidence.fileKind !== 'video' ||
    evidence.scope !== 'local' ||
    typeof evidence.path !== 'string' ||
    !evidence.path.startsWith('/vol2/1000/Media/movie/') ||
    !Number.isSafeInteger(evidence.mtimeMs) ||
    Number(evidence.mtimeMs) < 0 ||
    !Number.isSafeInteger(evidence.size) ||
    Number(evidence.size) < 1;
  if (keysInvalid || identityInvalid || evidenceInvalid) {
    throw new Error('canonical-replacement-contract-invalid');
  }
  return structuredClone(
    replacement as unknown as MediaGovernanceCanonicalReplacement,
  );
}
