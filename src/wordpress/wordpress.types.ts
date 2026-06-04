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
  auth: WordpressAuthContext;
  body?: Record<string, unknown>;
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, unknown>;
};

export type WordpressResponse<T> = {
  data: T;
  total?: number;
};
