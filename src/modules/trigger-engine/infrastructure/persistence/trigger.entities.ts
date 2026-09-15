import { Entity } from 'typeorm';
import {
  DefinitionDraftRow,
  DefinitionRevisionRow,
} from '@/common/automation/definition.entities';

@Entity('automation_trigger')
export class TriggerDraft extends DefinitionDraftRow {}

@Entity('automation_trigger_revision')
export class TriggerRevision extends DefinitionRevisionRow {}
