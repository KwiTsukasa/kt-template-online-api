import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ensureSnowflakeId } from '@/common';
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

  @CreateDateColumn({
    name: 'create_time',
  })
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  updateTime: Date;

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

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
