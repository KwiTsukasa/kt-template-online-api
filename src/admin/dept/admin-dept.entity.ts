import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId, FormatDateTime } from '@/common';

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

  @CreateDateColumn({
    name: 'create_time',
  })
  @FormatDateTime()
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  @FormatDateTime()
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
