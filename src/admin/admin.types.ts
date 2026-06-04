import type { Request } from 'express';
import type { AdminMenu } from './menu/admin-menu.entity';
import type { AdminRole } from './role/admin-role.entity';
import type { AdminUser } from './user/admin-user.entity';

export type AdminDemoTableRow = {
  available: boolean;
  category: string;
  color: string;
  currency: string;
  description: string;
  id: string;
  imageUrl: string;
  imageUrl2: string;
  inProduction: boolean;
  open: boolean;
  price: string;
  productName: string;
  quantity: number;
  rating: number;
  releaseDate: string;
  status: string;
  tags: string[];
  weight: number;
};

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
