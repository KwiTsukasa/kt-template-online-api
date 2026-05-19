import { HttpException, HttpStatus } from '@nestjs/common';

export type VbenResponse<T = any> = {
  code: 200;
  data: T;
  msg: string;
};

export type ApiErrorResponse = {
  code: number;
  msg: string;
  err: any;
};

export const vbenSuccess = <T = any>(
  data: T,
  msg = '操作成功',
): VbenResponse<T> => ({
  code: 200,
  data,
  msg,
});

export const vbenPage = <T = any>(items: T[], total: number) =>
  vbenSuccess({
    items,
    total,
  });

export const throwVbenError = (
  message: string,
  status = HttpStatus.BAD_REQUEST,
  err: any = message,
): never => {
  throw new HttpException(
    {
      msg: message,
      err,
    },
    status,
  );
};
