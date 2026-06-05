import type {
  WordpressArticleListQueryDto,
  WordpressTermListQueryDto,
} from './wordpress.dto';

export type WordpressAuthContext = {
  authorization?: string;
  cookie?: string;
  nonce?: string;
};

export type WordpressAvailabilityError = {
  error: any;
  message: string;
  status: number;
};

export type WordpressAvailabilityCache = {
  available: boolean;
  checkedAt: number;
  error?: WordpressAvailabilityError;
};

export type WordpressLoginResult = {
  auth: {
    nonce: string;
    type: 'cookie';
  };
  user: any;
};

export type WordpressOptionalLoginResult =
  | {
      available: false;
      error: WordpressAvailabilityError;
      result: null;
    }
  | {
      available: true;
      error: null;
      result: WordpressLoginResult & { cookie: string };
    };

export type WordpressPagedQueryDto =
  | WordpressArticleListQueryDto
  | WordpressTermListQueryDto;

export type WordpressRequestOptions = {
  auth?: WordpressAuthContext;
  body?: Record<string, unknown>;
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, unknown>;
};

export type WordpressResponse<T> = {
  data: T;
  total?: number;
};

export type WordpressArgonMenuItem = {
  external?: boolean;
  href: string;
  icon?: string;
  label: string;
};

export type WordpressArgonThemeConfig = {
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
  headerMenu?: WordpressArgonMenuItem[];
  htmlClass: string[];
  site: {
    authorAvatar?: string;
    authorName?: string;
    description: string;
    home: string;
    title: string;
    url: string;
  };
  sidebarMenu?: WordpressArgonMenuItem[];
  themeCardRadius: number;
  themeColor: string;
  themeColorRgb: string;
  themeVersion: string;
};
