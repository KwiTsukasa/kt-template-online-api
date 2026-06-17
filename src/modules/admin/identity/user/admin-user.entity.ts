import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
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
    default: '',
    length: 1024,
  })
  avatar: string;

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

  @KtCreateDateColumn({
    name: 'create_time',
  })
  createTime: KtDateTime;

  @KtUpdateDateColumn({
    name: 'update_time',
  })
  updateTime: KtDateTime;

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

  /**
   * 创建 Admin 身份权限对象或配置。
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
