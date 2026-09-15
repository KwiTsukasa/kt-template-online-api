import { Entity } from 'typeorm';
import {
  DefinitionDraftRow,
  DefinitionRevisionRow,
} from '@/common/automation/definition.entities';

@Entity('automation_workflow')
export class WorkflowDraft extends DefinitionDraftRow {}

@Entity('automation_workflow_revision')
export class WorkflowRevision extends DefinitionRevisionRow {}
