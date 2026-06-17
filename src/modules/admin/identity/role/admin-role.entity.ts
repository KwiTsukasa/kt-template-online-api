import {
  BeforeInsert,
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryColumn,
} from 'typeorm';
import {
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
import { AdminMenu } from '../menu/admin-menu.entity';
import { AdminUser } from '../user/admin-user.entity';

@Entity('admin_role')
export class AdminRole {
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @Column({
    name: 'role_code',
    unique: true,
  })
  roleCode: string;

  @Column()
  name: string;

  @Column({
    default: '',
  })
  remark: string;

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

  @ManyToMany(() => AdminMenu, (menu) => menu.roles)
  @JoinTable({
    inverseJoinColumn: {
      name: 'menu_id',
      referencedColumnName: 'id',
    },
    joinColumn: {
      name: 'role_id',
      referencedColumnName: 'id',
    },
    name: 'admin_role_menu',
  })
  menus: AdminMenu[];

  @ManyToMany(() => AdminUser, (user) => user.roles)
  users: AdminUser[];

  /**
   * 创建 Admin 身份权限对象或配置。
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
