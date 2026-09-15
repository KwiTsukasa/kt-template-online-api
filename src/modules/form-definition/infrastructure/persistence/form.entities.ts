import { Entity } from 'typeorm';
import { DefinitionDraftRow, DefinitionRevisionRow } from '@/common/automation/definition.entities';

@Entity('automation_form')
export class FormDraft extends DefinitionDraftRow {}

@Entity('automation_form_revision')
export class FormRevision extends DefinitionRevisionRow {}
