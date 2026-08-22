export type TencentReplyContext = {
  msgId?: string;
  scope: 'c2c' | 'group';
  targetId: string;
};

export type TencentMenuItem = {
  link?: string;
  name: string;
  send_message?: string;
  sub_menu_items?: TencentSubMenuItem[];
  switch?: {
    default: boolean;
    switch_id: string;
  };
  type: 'link' | 'menu' | 'send_message' | 'switch';
};

export type TencentSubMenuItem = {
  link?: string;
  name: string;
  send_message?: string;
  type: 'link' | 'send_message';
};

export type TencentPanelItem = {
  desc: string;
  link?: string;
  name: string;
  only_admin: boolean;
  type: 'command' | 'link';
};

export type TencentPanelScope = 'c2c' | 'channel' | 'dm' | 'group';

export type TencentPluginMenuProjection = {
  menuItems: TencentMenuItem[];
  panels: Record<TencentPanelScope, TencentPanelItem[]>;
};
