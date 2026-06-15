import type { Request } from 'express';
import type { AdminMenu } from '../identity/menu/admin-menu.entity';
import type { AdminRole } from '../identity/role/admin-role.entity';
import type { AdminUser } from '../identity/user/admin-user.entity';

export type AdminDictItem = {
  childrenCode?: string | null;
  label: string;
  value: string;
};

export type AdminDictGroupItem = {
  dictCode: string;
  id: string;
  itemCount: number;
  label: string;
  value: string;
};

export type AdminDictSerialized = {
  childrenCode?: string | null;
  createTime?: Date;
  dictCode: string;
  id: string;
  label: string;
  sort?: number;
  status?: number;
  updateTime?: Date;
  value: string;
};

export type AdminDictTreeItem = AdminDictSerialized & {
  children?: AdminDictTreeItem[];
  treeKey: string;
};

export type AdminMenuMeta = Record<string, any>;

export type AdminMenuType = 'button' | 'catalog' | 'embedded' | 'link' | 'menu';

export type AdminMenuInput = Partial<AdminMenu> & {
  activePath?: string;
  linkSrc?: string;
};

export type AdminRequest = Request & {
  adminUser?: AdminUser;
};

export type AdminRoleInput = Partial<AdminRole> & {
  permissions?: string[];
};

export type AdminRoleListQuery = Record<string, any>;

export type AdminTokenPayload = {
  exp: number;
  iat: number;
  sub: string;
  type: 'access' | 'refresh';
  username: string;
};

export type AdminUserInput = Partial<AdminUser> & {
  roleIds?: string[];
};

export type AdminUserListQuery = Record<string, any>;
