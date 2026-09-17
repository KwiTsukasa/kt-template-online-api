import { RUN_STATUS_GROUP } from '@/common/automation/constants/run-status';

export const WORKFLOW_ACTIVE_SUBJECT_INDEX =
  'uk_automation_workflow_active_subject';
export const WORKFLOW_ACTIVE_SUBJECT_EXPRESSION = `CASE WHEN status IN (${RUN_STATUS_GROUP.workflowOpen.map((status) => `'${status}'`).join(',')}) THEN business_subject_key ELSE NULL END`;

export const WORKFLOW_CONFLICT_MESSAGE = {
  activeSubject: '该业务对象已有未结束工作流',
  requestReused: '流程请求键已经用于不同内容',
} as const;
