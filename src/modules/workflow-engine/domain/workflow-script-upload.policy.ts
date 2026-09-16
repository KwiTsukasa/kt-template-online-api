import { createHash } from 'node:crypto';
import { definitionRecord } from '@/common/automation/definition.types';
import {
  normalizeDataSchema,
  validateFieldValue,
  type DataScalar,
} from '@/common/automation/data-schema';

export const WORKFLOW_SCRIPT_PROTOCOL = 'kt.workflow.script.v1' as const;

/**
 * 将 Bash 源码的 BOM 与 Windows 换行规范为可直接执行的 UTF-8/LF，摘要和持久源码使用同一内容。
 * @param filename - 已校验的上传文件名。
 * @param source - 上传的原始文本。
 * @returns Bash 的规范文本或其他解释器的原始文本。
 */
export function normalizeWorkflowScriptSource(
  filename: string,
  source: string,
): string {
  if (filename.toLowerCase().endsWith('.sh'))
    return source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return source;
}

/**
 * 静态读取脚本开头的标准声明，不执行上传代码；业务参数只从 paramsSchema 与 defaults 识别。
 * @param filename - 上传文件名，接受 Node 模块、Python 或 Bash 脚本后缀。
 * @param source - 用户上传的完整 UTF-8 源码。
 * @returns 标准协议、参数控件契约、结果契约、内容摘要及解释器类型。
 * @throws 声明缺失、扩展越过标准字段、参数不合法或脚本超限时拒绝上传。
 */
export function parseWorkflowScriptUpload(filename: unknown, source: unknown) {
  if (
    typeof filename !== 'string' ||
    !/^[^/\\\0]{1,120}\.(mjs|py|sh)$/i.test(filename)
  )
    throw new Error('仅支持上传 .mjs、.py 或 .sh 脚本');
  if (
    typeof source !== 'string' ||
    !source.trim() ||
    Buffer.byteLength(source) > 256 * 1024
  )
    throw new Error('脚本大小需要在 1 字节至 256 KiB 之间');
  source = normalizeWorkflowScriptSource(filename, source);
  let runtime: 'bash' | 'node' | 'python' = 'node';
  let start = '/* @kt-workflow-script';
  let end = '@end-kt-workflow-script */';
  if (filename.toLowerCase().endsWith('.py')) {
    runtime = 'python';
    start = '"""@kt-workflow-script';
    end = '@end-kt-workflow-script"""';
  }
  if (filename.toLowerCase().endsWith('.sh')) {
    runtime = 'bash';
    start = '# @kt-workflow-script';
    end = '# @end-kt-workflow-script';
  }
  const content = (source as string)
    .replace(/^\uFEFF/, '')
    .replace(/^#![^\n]*\n/, '')
    .trimStart();
  const endIndex = content.indexOf(end);
  if (
    !content.startsWith(start) ||
    endIndex < start.length ||
    endIndex > 32 * 1024
  )
    throw new Error('脚本开头缺少标准 @kt-workflow-script 声明区');
  let declaration = content.slice(start.length, endIndex);
  if (runtime === 'bash') {
    declaration = declaration
      .split('\n')
      .map((line) => {
        if (!line.trim()) return '';
        if (!/^\s*#/.test(line))
          throw new Error('Bash 标准声明中的 JSON 每行必须使用 # 注释');
        return line.replace(/^\s*# ?/, '');
      })
      .join('\n');
  }
  const metadata = definitionRecord(JSON.parse(declaration));
  const allowed = [
    'protocol',
    'key',
    'name',
    'description',
    'processKey',
    'stepKey',
    'maxTimeoutMs',
    'idempotent',
    'paramsSchema',
    'resultSchema',
    'defaults',
  ];
  if (Object.keys(metadata).some((key) => !allowed.includes(key)))
    throw new Error('标准声明存在未知字段，业务参数必须放入 paramsSchema');
  if (metadata.protocol !== WORKFLOW_SCRIPT_PROTOCOL)
    throw new Error('脚本必须声明 kt.workflow.script.v1 标准输入输出协议');
  if (
    typeof metadata.key !== 'string' ||
    !/^[a-z][a-z0-9.-]{2,63}$/.test(metadata.key) ||
    typeof metadata.name !== 'string' ||
    !metadata.name.trim() ||
    metadata.name.length > 128
  )
    throw new Error('脚本标识或名称无效');
  if (
    typeof metadata.description !== 'string' ||
    metadata.description.length > 2048
  )
    throw new Error('脚本说明需要为 2048 字符以内的文本');
  if (
    typeof metadata.processKey !== 'string' ||
    !/^[a-z][a-z0-9.-]{2,63}$/.test(metadata.processKey) ||
    typeof metadata.stepKey !== 'string' ||
    !/^[a-z][a-z0-9.-]{1,63}$/.test(metadata.stepKey)
  )
    throw new Error('脚本必须声明适用业务接口与步骤');
  if (
    !Number.isSafeInteger(metadata.maxTimeoutMs) ||
    Number(metadata.maxTimeoutMs) < 1000 ||
    Number(metadata.maxTimeoutMs) > 24 * 86400000 ||
    typeof metadata.idempotent !== 'boolean'
  )
    throw new Error('脚本最大超时或幂等声明无效');
  const paramsSchema = normalizeDataSchema(metadata.paramsSchema);
  const resultSchema = normalizeDataSchema(metadata.resultSchema);
  const defaults: Record<string, DataScalar> = {};
  for (const [key, value] of Object.entries(
    definitionRecord(metadata.defaults),
  )) {
    const field = paramsSchema.fields.find((field) => field.key === key);
    if (!field) throw new Error(`默认参数未声明：${key}`);
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
    runtime,
    maxTimeoutMs: Number(metadata.maxTimeoutMs),
    idempotent: metadata.idempotent,
    paramsSchema,
    resultSchema,
    defaults,
    sha256: createHash('sha256')
      .update(source as string)
      .digest('hex'),
  };
}
