import type { DataSchema, DataScalar } from '@/common/automation/data-schema';
import type { PublishedReference } from '@/common/automation/definition.types';

export type FormControl =
  | 'Input'
  | 'Textarea'
  | 'InputNumber'
  | 'Switch'
  | 'Select'
  | 'RadioGroup'
  | 'DatePicker';
export type FormFieldLayout = {
  key: string;
  component: FormControl;
  span: number;
  placeholder: string;
  help: string;
  requiredWhen?: { field: string; equals: DataScalar };
};
export type FormDefinition = {
  schemaVersion: 1;
  dataSchema: DataSchema;
  uiSchema: {
    columns: 1 | 2 | 3;
    fields: FormFieldLayout[];
  };
};
export const FORM_DEFINITIONS = Symbol('FORM_DEFINITIONS');
export interface FormDefinitionPort {
  resolve: (reference: PublishedReference) => Promise<FormDefinition>;
  validate: (
    reference: PublishedReference,
    input: unknown,
    writableFields?: readonly string[],
  ) => Promise<Record<string, DataScalar>>;
}
