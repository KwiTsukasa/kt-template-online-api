import {
  BeforeInsert,
  Column,
  Entity,
  ManyToMany,
  PrimaryColumn,
} from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import { AdminRole } from '../role/admin-role.entity';
import type { AdminMenuMeta, AdminMenuType } from '../../contract/admin.types';

@Entity('admin_menu')
export class AdminMenu {
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @Column({
    default: 0,
    type: 'bigint',
  })
  pid: string;

  @Column({
    length: 120,
    unique: true,
  })
  name: string;

  @Column({
    length: 255,
    nullable: true,
  })
  path: string;

  @Column({
    length: 255,
    nullable: true,
  })
  component: string;

  @Column({
    length: 255,
    nullable: true,
  })
  redirect: string;

  @Column({
    name: 'auth_code',
    length: 120,
    nullable: true,
  })
  authCode: string;

  @Column({
    default: 'menu',
    length: 32,
  })
  type: AdminMenuType;

  @Column({
    nullable: true,
    type: 'simple-json',
  })
  meta: AdminMenuMeta;

  @Column({
    default: 1,
  })
  status: number;

  @Column({
    default: 0,
  })
  sort: number;

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

  @ManyToMany(() => AdminRole, (role) => role.menus)
  roles: AdminRole[];

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
