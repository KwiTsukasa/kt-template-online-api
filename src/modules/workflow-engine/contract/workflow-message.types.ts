export type BpmnCorrelationValues = Record<string, Record<string, unknown>>;

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
  status: 'pending' | 'delivered' | 'discarded';
  receivedAt: string;
  deliveredAt: string | null;
}

export interface WorkflowMessageRecord extends WorkflowMessageReceipt {
  hash: string;
  values?: Record<string, unknown>;
  correlation?: { processExecutionId: string; keys: BpmnCorrelationValues };
}
