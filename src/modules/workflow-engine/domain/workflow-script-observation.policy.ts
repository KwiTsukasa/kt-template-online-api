import { requireDefinition } from '@/common/automation/validation';
import { normalizeWorkflowScriptReference } from './workflow-script-declaration.policy';
import { RUN_STATUS } from '@/common/automation/constants/run-status';
import { definitionRecord } from '@/common/automation/definition.types';
import type { WorkflowScriptObservation } from '../contract/workflow-script.types';
import { normalizeWorkflowPayload } from './workflow-script.policy';

/**
 * 统一核对本地与 NAS 回执，只输出固定状态字段与隔离的业务结果，拒绝身份漂移和伪成功。
 * @param input - 运行包装器或远端控制程序返回的原始记录。
 * @param executionId - 工作流已保存的当前脚本尝试身份。
 * @param allowActive - 远端状态查询允许活动回执，本地终态文件只允许退出结果。
 * @returns 已校验的活动状态或固定版本脚本结果。
 * @throws 身份、状态、退出码、脚本引用或业务结果不合法时拒绝接收。
 */
export function normalizeWorkflowScriptObservation(
  input: unknown,
  executionId: string,
  allowActive: boolean,
): WorkflowScriptObservation {
  const record = definitionRecord(input);
  requireDefinition(
    record.executionId === executionId,
    '工作流脚本回执身份不匹配',
  );
  const status = record.status;
  if (
    allowActive &&
    (status === RUN_STATUS.running || status === RUN_STATUS.unconfirmed)
  )
    return { executionId, status };
  requireDefinition(
    status === RUN_STATUS.succeeded ||
      status === RUN_STATUS.failed ||
      status === RUN_STATUS.cancelled,
    '工作流脚本退出状态无效',
  );
  const script = normalizeWorkflowScriptReference(record.script);
  const exitCode = record.exitCode;
  requireDefinition(
    exitCode === null ||
      (typeof exitCode === 'number' &&
        Number.isSafeInteger(exitCode) &&
        exitCode >= 0),
    '工作流脚本退出码无效',
  );
  requireDefinition(
    status !== RUN_STATUS.succeeded || exitCode === 0,
    '工作流脚本成功回执缺少正常退出码',
  );
  return {
    executionId,
    status,
    script,
    exitCode: exitCode as number | null,
    output: normalizeWorkflowPayload(record.output),
  };
}
