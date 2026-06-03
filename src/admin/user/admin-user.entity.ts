import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import { AdminDept } from '../dept/admin-dept.entity';
import { AdminRole } from '../role/admin-role.entity';

@Entity('admin_user')
export class AdminUser {
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @Column({
    unique: true,
  })
  username: string;

  @Column()
  password: string;

  @Column({
    name: 'real_name',
  })
  realName: string;

  @Column({
    name: 'dept_id',
    nullable: true,
    type: 'bigint',
  })
  deptId?: string | null;

  @Column({
    default: '',
    name: 'home_path',
  })
  homePath: string;

  @Column({
    default: 'Asia/Shanghai',
  })
  timezone: string;

  @Column({
    default: 1,
  })
  status: number;

  @Column({
    default: false,
    name: 'is_deleted',
  })
  isDeleted: boolean;

  @CreateDateColumn({
    name: 'create_time',
  })
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  updateTime: Date;

  @ManyToMany(() => AdminRole, (role) => role.users, {
    eager: true,
  })
  @JoinTable({
    inverseJoinColumn: {
      name: 'role_id',
      referencedColumnName: 'id',
    },
    joinColumn: {
      name: 'user_id',
      referencedColumnName: 'id',
    },
    name: 'admin_user_role',
  })
  roles: AdminRole[];

  @ManyToOne(() => AdminDept, {
    eager: true,
    nullable: true,
  })
  @JoinColumn({
    name: 'dept_id',
  })
  dept?: AdminDept | null;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
