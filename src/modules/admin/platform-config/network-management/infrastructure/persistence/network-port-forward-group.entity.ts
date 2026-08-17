import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';

@Entity('network_port_forward_group')
export class NetworkPortForwardGroup {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ nullable: true, type: 'text' })
  remark?: string | null;

  @Column({ name: 'external_port', type: 'int', unsigned: true })
  externalPort: number;

  @Column({ name: 'internal_port', type: 'int', unsigned: true })
  internalPort: number;

  @Column({ length: 8, name: 'protocol_mode' })
  protocolMode: string;

  @Column({ length: 15, name: 'target_ipv4' })
  targetIpv4: string;

  @Column({ default: false, name: 'is_deleted', type: 'boolean' })
  isDeleted: boolean;

  @KtCreateDateColumn({ name: 'create_time', precision: 6 })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time', precision: 6 })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId(): string {
    return ensureSnowflakeId(this);
  }
}
