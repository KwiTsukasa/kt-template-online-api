import { Entity } from 'typeorm';
import { DefinitionDraftRow, DefinitionRevisionRow } from '@/common/automation/definition.entities';

@Entity('automation_ruleset')
export class RuleDraft extends DefinitionDraftRow {}

@Entity('automation_ruleset_revision')
export class RuleRevision extends DefinitionRevisionRow {}
