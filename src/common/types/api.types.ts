export type KtSuccessResponse<T = any> = {
  code: 200;
  data: T;
  msg: string;
};

export type KtErrorResponse = {
  code: number;
  err: string;
  msg: string;
};

export type KtResponse<T = any> = KtErrorResponse | KtSuccessResponse<T>;

export type KtPage<T = any> = {
  list: T[];
  total: number;
};

export type KtPageQuery = {
  pageNo?: number | string;
  pageSize?: number | string;
};

export type KtPageParams<T = Record<string, any>> = {
  pageNo: number;
  pageSize: number;
} & Partial<T>;

export type KtDictOption<T = object, V = any> = {
  label: string;
  value: V;
} & Partial<T>;

export type KtMaybeArray<T> = T | readonly T[];
