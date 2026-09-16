import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('automation_workflow_business_binding')
export class WorkflowBusinessBinding {
  @PrimaryColumn({ name: 'process_key', length: 64 }) processKey: string;
  @PrimaryColumn({ name: 'scope_id', length: 96 }) scopeId: string;
  @Column({ name: 'process_version', type: 'int' }) processVersion: number;
  @Column({ name: 'workflow_id', type: 'bigint' }) workflowId: string;
  @Column({ name: 'workflow_version', type: 'int' }) workflowVersion: number;
  @Column({ type: 'int' }) revision: number;
}
