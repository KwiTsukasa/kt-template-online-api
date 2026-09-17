import {
  requireDefinition,
  requireDefinitionKeys,
} from '@/common/automation/validation';
import { automationDigest } from '@/common/automation/content-digest';
import { definitionRecord } from '@/common/automation/definition.types';

import {
  SCRIPT_DECLARATION_FIELDS,
  SCRIPT_ERROR,
  SCRIPT_LIMITS,
  SCRIPT_PATTERN,
} from '../constants/script';
import { normalizeWorkflowScriptDeclaration } from './workflow-script-declaration.policy';

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
  requireDefinition(
    typeof filename === 'string' && SCRIPT_PATTERN.filename.test(filename),
    '仅支持上传 .mjs、.py 或 .sh 脚本',
  );
  requireDefinition(
    typeof source === 'string' &&
      source.trim() &&
      Buffer.byteLength(source) <= SCRIPT_LIMITS.sourceBytes,
    '脚本大小需要在 1 字节至 256 KiB 之间',
  );
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
  requireDefinition(
    content.startsWith(start) &&
      endIndex >= start.length &&
      endIndex <= SCRIPT_LIMITS.declarationBytes,
    '脚本开头缺少标准 @kt-workflow-script 声明区',
  );
  let declaration = content.slice(start.length, endIndex);
  if (runtime === 'bash') {
    declaration = declaration
      .split('\n')
      .map((line) => {
        if (!line.trim()) return '';
        requireDefinition(
          /^\s*#/.test(line),
          'Bash 标准声明中的 JSON 每行必须使用 # 注释',
        );
        return line.replace(/^\s*# ?/, '');
      })
      .join('\n');
  }
  const metadata = definitionRecord(JSON.parse(declaration));
  requireDefinitionKeys(
    metadata,
    SCRIPT_DECLARATION_FIELDS,
    SCRIPT_ERROR.declarationFields,
  );
  return {
    ...normalizeWorkflowScriptDeclaration(metadata),
    runtime,
    sha256: automationDigest(source as string),
  };
}
