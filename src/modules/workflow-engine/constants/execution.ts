export const WORKFLOW_EXECUTION_TIMING = Object.freeze({
  recoveryMs: 30_000,
  businessDeadlineMs: 15_000,
  actionPollMs: 500,
  cancellationPollMs: 1000,
  retainedTransitions: 2000,
});

export const WORKFLOW_EXECUTION_ERROR = Object.freeze({
  actionUnavailable: '内置动作能力未装配',
  businessUnavailable: '业务上下文缺失',
  scriptsUnavailable: '工作流脚本运行时尚未装配',
  ruleRejected: '固定版本规则求值失败',
  businessRejected: '业务步骤参数或结果未通过校验',
});

export const WORKFLOW_STEP_SCHEMA = {
  confirmation: {
    fields: [
      { key: 'confirmed', label: '已确认', type: 'boolean', required: true },
    ],
  },
  condition: {
    fields: [
      { key: 'result', label: '规则结果', type: 'boolean', required: true },
    ],
  },
} satisfies Record<
  string,
  import('@/common/automation/data-schema').DataSchema
>;
export const WORKFLOW_EXECUTION_KEY_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9:._-]{7,190}$/;
