type Res = {
  code: number;
  msg: string;
  data: any;
};

type Page<T = any> = {
  list: T[];
  total: number;
};

type Dict<T = object> = {
  label: string;
  value: any;
} & Partial<T>;

type PageParams<T> = {
  pageSize: number;
  pageNo: number;
} & Partial<T>;

type Many<T> = T | readonly T[];
