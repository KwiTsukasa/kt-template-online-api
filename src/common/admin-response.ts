import { HttpException, HttpStatus } from '@nestjs/common';

export type VbenResponse<T = any> = {
  code: number;
  data: T;
  error: any;
  message: string;
};

export const vbenSuccess = <T = any>(data: T): VbenResponse<T> => ({
  code: 0,
  data,
  error: null,
  message: 'ok',
});

export const vbenPage = <T = any>(items: T[], total: number) =>
  vbenSuccess({
    items,
    total,
  });

export const throwVbenError = (
  message: string,
  status = HttpStatus.BAD_REQUEST,
  error: any = message,
): never => {
  throw new HttpException(
    {
      code: -1,
      data: null,
      error,
      message,
    },
    status,
  );
};
