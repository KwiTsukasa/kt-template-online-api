type Res =
  | {
      code: 200;
      msg: string;
      data: any;
    }
  | {
      code: number;
      msg: string;
      err: any;
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
