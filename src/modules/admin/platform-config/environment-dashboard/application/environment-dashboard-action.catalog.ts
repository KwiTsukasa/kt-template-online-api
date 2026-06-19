import type { EnvironmentAction } from '../domain/environment-dashboard.types';

export const HIGH_RISK_ENVIRONMENT_ACTION_IDS = [
  'restart-api-pod',
  'trigger-jenkins-deploy',
  'run-db-migration',
  'recreate-napcat-container',
  'toggle-plugin',
  'run-plugin-task-now',
  'create-minio-bucket',
  'wordpress-import',
  'reload-caddy',
  'switch-openclash',
  'restart-tencent-cvm',
  'modify-wireguard-peer',
] as const;

const READONLY_ACTIONS: EnvironmentAction[] = [
  {
    enabled: true,
    id: 'refresh-dashboard',
    kind: 'readonly',
    label: '刷新快照',
    riskLevel: 'low',
  },
  {
    enabled: true,
    id: 'run-self-check',
    kind: 'readonly',
    label: '运行只读自检',
    riskLevel: 'low',
  },
  {
    enabled: true,
    id: 'open-runtime-logs',
    kind: 'readonly',
    label: '打开运行日志',
    riskLevel: 'low',
  },
  {
    enabled: true,
    id: 'open-service-route',
    kind: 'readonly',
    label: '打开服务入口',
    riskLevel: 'low',
  },
];

const highRiskLabels: Record<
  (typeof HIGH_RISK_ENVIRONMENT_ACTION_IDS)[number],
  string
> = {
  'create-minio-bucket': '创建 MinIO Bucket',
  'modify-wireguard-peer': '修改 WireGuard Peer',
  'recreate-napcat-container': '重建 NapCat 容器',
  'reload-caddy': '重载 Caddy',
  'restart-api-pod': '重启 API Pod',
  'restart-tencent-cvm': '重启腾讯云 CVM',
  'run-db-migration': '执行数据库迁移',
  'run-plugin-task-now': '立即运行插件任务',
  'switch-openclash': '切换 OpenClash 策略',
  'toggle-plugin': '启停插件',
  'trigger-jenkins-deploy': '触发 Jenkins 部署',
  'wordpress-import': '导入 WordPress 内容',
};

/**
 * Builds the visible dashboard action catalog without adding write endpoints.
 * @returns Readonly actions plus disabled high-risk records with operator-facing reasons.
 */
export function getEnvironmentDashboardActions(): EnvironmentAction[] {
  const highRiskActions = HIGH_RISK_ENVIRONMENT_ACTION_IDS.map((id) => ({
    disabledReason: '第一版环境总览只读展示，高风险写操作需走专项流程。',
    enabled: false,
    id,
    kind: 'write-risk' as const,
    label: highRiskLabels[id],
    riskLevel: 'high' as const,
  }));

  return [...READONLY_ACTIONS, ...highRiskActions];
}
