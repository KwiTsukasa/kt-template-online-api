export type BlogArgonMenuItem = {
  external?: boolean;
  href: string;
  icon?: string;
  label: string;
};

export type BlogArgonThemeConfig = {
  argonConfig: {
    codeHighlight: {
      breakLine: boolean;
      enable: boolean;
      hideLinenumber: boolean;
      transparentLinenumber: boolean;
    };
    dateFormat: string;
    disablePjax: boolean;
    foldLongComments: boolean;
    foldLongShuoshuo: boolean;
    headroom: boolean | string;
    language: string;
    lazyload: {
      effect: string;
      threshold: number;
    };
    pangu: string;
    pjaxAnimationDuration: number;
    waterflowColumns: number | string;
    wpPath: string;
    zoomify: boolean;
  };
  backgroundDarkBrightness?: number;
  backgroundDarkImage?: string;
  backgroundDarkOpacity?: number;
  backgroundImage?: string;
  backgroundOpacity?: number;
  bodyClass: string[];
  darkmodeAutoSwitch: string;
  enableCustomThemeColor: boolean;
  headerMenu?: BlogArgonMenuItem[];
  htmlClass: string[];
  site: {
    authorAvatar?: string;
    authorName?: string;
    description: string;
    home: string;
    title: string;
    url: string;
  };
  sidebarMenu?: BlogArgonMenuItem[];
  themeCardRadius: number;
  themeColor: string;
  themeColorRgb: string;
  themeVersion: string;
};
