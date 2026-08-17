import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
@Entity('admin_dept')
export class AdminDept {
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @Column({
    default: 0,
    type: 'bigint',
  })
  pid: string;

  @Column()
  name: string;

  @Column({
    default: 1,
  })
  status: number;

  @Column({
    default: '',
  })
  remark: string;

  @Column({
    default: false,
    name: 'is_deleted',
  })
  isDeleted: boolean;

  @KtCreateDateColumn({
    name: 'create_time',
  })
  createTime: KtDateTime;

  @KtUpdateDateColumn({
    name: 'update_time',
  })
  updateTime: KtDateTime;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
