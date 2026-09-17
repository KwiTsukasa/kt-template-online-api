import { definitionRecord } from '@/common/automation/definition.types';
import {
  normalizeDataSchema,
  validateFieldValue,
  type DataScalar,
} from '@/common/automation/data-schema';
import {
  definitionInteger,
  requireDefinition,
} from '@/common/automation/validation';
import type {
  WorkflowScriptDefinition,
  WorkflowScriptReference,
} from '../contract/workflow-script.types';
import {
  SCRIPT_ERROR,
  SCRIPT_LIMITS,
  SCRIPT_PATTERN,
  WORKFLOW_SCRIPT_PROTOCOL,
} from '../constants/script';

/**
 * 统一校验上传及内置脚本的业务声明，默认值按一次字段索引校验，注册端不能跳过协议要求。
 * @param input - 标准声明或包含标准声明的内置脚本配置。
 * @returns 规范化的业务元数据，不包含宿主路径、解释器或发布身份。
 * @throws 标准协议、适用步骤、超时、字段契约或默认值非法时拒绝声明。
 */
export function normalizeWorkflowScriptDeclaration(
  input: unknown,
): Omit<
  WorkflowScriptDefinition,
  'path' | 'runtime' | 'sha256' | 'target' | 'version'
> {
  const metadata = definitionRecord(input);
  requireDefinition(
    metadata.protocol === WORKFLOW_SCRIPT_PROTOCOL,
    SCRIPT_ERROR.protocol,
  );
  requireDefinition(
    typeof metadata.key === 'string' &&
      SCRIPT_PATTERN.key.test(metadata.key) &&
      typeof metadata.name === 'string' &&
      metadata.name.trim() &&
      metadata.name.length <= SCRIPT_LIMITS.nameLength,
    SCRIPT_ERROR.name,
  );
  requireDefinition(
    typeof metadata.description === 'string' &&
      metadata.description.length <= SCRIPT_LIMITS.descriptionLength,
    SCRIPT_ERROR.description,
  );
  requireDefinition(
    typeof metadata.processKey === 'string' &&
      SCRIPT_PATTERN.key.test(metadata.processKey) &&
      typeof metadata.stepKey === 'string' &&
      SCRIPT_PATTERN.stepKey.test(metadata.stepKey),
    SCRIPT_ERROR.scope,
  );
  requireDefinition(
    typeof metadata.idempotent === 'boolean',
    SCRIPT_ERROR.idempotence,
  );
  const maxTimeoutMs = definitionInteger(
    metadata.maxTimeoutMs,
    SCRIPT_LIMITS.minTimeoutMs,
    SCRIPT_LIMITS.maxTimeoutMs,
    SCRIPT_ERROR.timeout,
  );
  const paramsSchema = normalizeDataSchema(metadata.paramsSchema);
  const resultSchema = normalizeDataSchema(metadata.resultSchema);
  const fields = new Map(
    paramsSchema.fields.map((field) => [field.key, field]),
  );
  const defaults: Record<string, DataScalar> = {};
  for (const [key, value] of Object.entries(
    definitionRecord(metadata.defaults),
  )) {
    const field = fields.get(key);
    requireDefinition(field, SCRIPT_ERROR.defaults);
    validateFieldValue(field, value);
    defaults[key] = value as DataScalar;
  }
  return {
    protocol: WORKFLOW_SCRIPT_PROTOCOL,
    key: metadata.key,
    name: metadata.name.trim(),
    description: metadata.description,
    processKey: metadata.processKey,
    stepKey: metadata.stepKey,
    maxTimeoutMs,
    idempotent: metadata.idempotent,
    paramsSchema,
    resultSchema,
    defaults,
  };
}

/**
 * 统一核验脚本不可变身份，上传、注册、发布和结果比对共用相同摘要与版本约束。
 * @param input - 带有脚本标识、版本和源码摘要的对象。
 * @returns 已核验的精确脚本身份。
 * @throws 标识、版本或摘要非法时拒绝引用。
 */
export function normalizeWorkflowScriptReference(
  input: unknown,
): WorkflowScriptReference {
  const reference = definitionRecord(input);
  requireDefinition(
    typeof reference.key === 'string' &&
      SCRIPT_PATTERN.key.test(reference.key) &&
      typeof reference.sha256 === 'string' &&
      SCRIPT_PATTERN.sha256.test(reference.sha256),
    SCRIPT_ERROR.identity,
  );
  const version = definitionInteger(
    reference.version,
    1,
    Number.MAX_SAFE_INTEGER,
    SCRIPT_ERROR.identity,
  );
  return { key: reference.key, version, sha256: reference.sha256 };
}
