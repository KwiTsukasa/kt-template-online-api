import { Column, Entity, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime } from '@/common';
import type { parseWorkflowScriptUpload } from '../../domain/workflow-script-upload.policy';

@Entity('automation_workflow_script')
export class WorkflowScriptAsset {
  @PrimaryColumn({ name: 'script_key', length: 64 }) key: string;
  @PrimaryColumn({ type: 'int' }) version: number;
  @Column({ length: 64 }) sha256: string;
  @Column({ length: 16 }) target: 'local' | 'nas';
  @Column({ type: 'json' }) declaration: ReturnType<
    typeof parseWorkflowScriptUpload
  >;
  @Column({ name: 'source_text', type: 'mediumtext' }) source: string;
  @KtCreateDateColumn({ name: 'create_time' }) createTime: KtDateTime;
}
