import { RUN_STATUS } from '@/common/automation/constants/run-status';
export type BpmnCorrelationValues = Record<string, Record<string, unknown>>;

export interface WorkflowBusinessMessage {
  deliveryId: string;
  messageId: string;
  senderId: string;
  values: Record<string, unknown>;
}

export interface WorkflowMessageIngress extends WorkflowBusinessMessage {
  ingressKey: string;
  ingressHash: string;
}

export interface WorkflowMessageDelivery {
  deliveryId: string;
  nodeId: string;
  executionId: string;
  messageId: string | null;
  senderId: string;
  values: Record<string, unknown>;
}

export interface WorkflowMessageReceipt {
  deliveryId: string;
  nodeId: string;
  executionId: string;
  status: typeof RUN_STATUS.pending | 'delivered' | 'discarded';
  receivedAt: string;
  deliveredAt: string | null;
}

export interface WorkflowMessageRecord extends WorkflowMessageReceipt {
  hash: string;
  ingressKey?: string;
  ingressHash?: string;
  values?: Record<string, unknown>;
  correlation?: { processExecutionId: string; keys: BpmnCorrelationValues };
}
