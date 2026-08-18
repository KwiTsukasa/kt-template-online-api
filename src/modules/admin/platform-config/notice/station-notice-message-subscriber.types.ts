export interface StationNoticeMessageBindingInput {
  enabled: boolean;
  notifyRoleCode: string;
  subscriptionId: string;
  title: string;
}

export interface StationNoticeMessageBindingView {
  available: boolean;
  createTime: string;
  enabled: boolean;
  id: string;
  invalidReasonCode: null | string;
  notifyRoleCode: string;
  sourceKey: string;
  sourceName: string;
  subscriptionId: string;
  subscriptionName: string;
  templates: Array<{
    id: string;
    name: string;
    sortOrder: number;
  }>;
  title: string;
  updateTime: string;
}
