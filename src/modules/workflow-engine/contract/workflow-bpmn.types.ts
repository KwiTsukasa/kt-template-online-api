import type { BPMN_FORMAT } from '../constants/bpmn';
import type { DataSchema } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';
import type { WorkflowProcessReference } from './workflow-process.interface';
import type { WorkflowScriptCall } from './workflow-script.types';
import type { ValueBinding } from './workflow.types';

export interface WorkflowBpmnDefinition {
  format: typeof BPMN_FORMAT;
  model: WorkflowBpmnRecord;
  /* 保存时从标准模型派生的查询索引；绑定和执行仍读取模型内的契约。 */
  processRef?: WorkflowProcessReference | null;
}

export interface WorkflowBpmnRecord {
  $type: string;
  [property: string]: unknown;
}

export interface WorkflowBpmnContract {
  processRef: WorkflowProcessReference | null;
  inputSchema: DataSchema;
  outputSchema: DataSchema;
  output: Record<string, ValueBinding>;
  formRef: PublishedReference | null;
  formMapping: Record<string, string>;
  timeoutMs: number;
}

export type WorkflowBpmnStep =
  | {
      kind: 'action';
      taskRef: PublishedReference;
      input: Record<string, ValueBinding>;
    }
  | {
      kind: 'human';
      businessKey?: string;
      formRef: PublishedReference | null;
      writableFields: string[];
      input: Record<string, ValueBinding>;
    }
  | {
      kind: 'business';
      stepKey: string;
      input: Record<string, ValueBinding>;
      scripts: WorkflowScriptCall[];
    }
  | {
      kind: 'rule';
      ruleRef: PublishedReference;
      input: Record<string, ValueBinding>;
    }
  | {
      kind: 'script';
      stepKey: string;
      scripts: WorkflowScriptCall[];
      input: Record<string, ValueBinding>;
    };

export interface WorkflowBpmnElement {
  $type: string;
  id?: string;
  name?: string;
  $parent?: WorkflowBpmnElement;
  $descriptor: WorkflowBpmnDescriptor;
  $instanceOf: (type: string) => boolean;
  get: (name: string) => unknown;
  set: (name: string, value: unknown) => void;
  [name: string]: any;
}

export interface WorkflowBpmnProperty {
  name: string;
  type: string;
  ns: { name: string };
  isVirtual?: boolean;
  isReference?: boolean;
  isMany?: boolean;
  isAttr?: boolean;
  isBody?: boolean;
}

export interface WorkflowBpmnDescriptor {
  properties: readonly WorkflowBpmnProperty[];
  propertiesByName: Readonly<Record<string, WorkflowBpmnProperty>>;
}

export interface WorkflowBpmnModel {
  definition: WorkflowBpmnDefinition;
  root: WorkflowBpmnElement;
  elements: Record<string, WorkflowBpmnElement>;
  processes: WorkflowBpmnElement[];
  references: Array<{
    element: WorkflowBpmnElement;
    property: string;
    id: string;
  }>;
}

export interface WorkflowBpmnIssue {
  code: string;
  message: string;
  nodeId?: string;
}
