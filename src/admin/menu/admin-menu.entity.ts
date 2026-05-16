import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import { AdminRole } from '../role/admin-role.entity';

export type AdminMenuType = 'button' | 'catalog' | 'embedded' | 'link' | 'menu';

export type AdminMenuMeta = Record<string, any>;

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

  @CreateDateColumn({
    name: 'create_time',
  })
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  updateTime: Date;

  @ManyToMany(() => AdminRole, (role) => role.menus)
  roles: AdminRole[];

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
