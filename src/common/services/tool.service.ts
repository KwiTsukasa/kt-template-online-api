import { Injectable } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';

@Injectable()
export class ToolsService {
  async captche(size = 4) {
    const captcha = svgCaptcha.create({
      size,
      fontSize: 50,
      width: 100,
      height: 34,
      background: '#ffffff',
    });
    return captcha;
  }

  res(code: number, msg: string, data: any): Res {
    const retn: Res = {
      code,
      msg,
      data,
    };
    return retn;
  }

  page<T = any>(list: T[], total: number): Page<T> {
    const retn = {
      list,
      total,
    };
    return retn;
  }

  getWhereStr(alias: string, key) {
    return `${alias}.${key.toString()} = :${key.toString()}`;
  }

  getLikeStr(alias: string, key) {
    return `${alias}.${key.toString()} like :${key.toString()}`;
  }

  getLikeWhere<T = object>(
    alias: string,
    wheres: Array<keyof T>,
    likes: Array<keyof T>,
    values: Partial<T>,
    operator: 'AND' | 'OR' = 'AND',
  ): [string, Record<string, unknown>] {
    const hasValue = (value: unknown) =>
      value !== undefined && value !== null && value !== '';

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    wheres.forEach((key) => {
      const value = values[key];

      if (!hasValue(value)) return;

      const paramKey = key.toString();
      conditions.push(this.getWhereStr(alias, key));
      params[paramKey] = value;
    });

    likes.forEach((key) => {
      const value = values[key];

      if (!hasValue(value)) return;

      const paramKey = key.toString();
      conditions.push(this.getLikeStr(alias, key));
      params[paramKey] = `%${value}%`;
    });

    return [conditions.join(` ${operator} `), params];
  }

  dictFormat<T = object>(
    label: string,
    value: any,
    other: Partial<T>,
  ): Dict<T> {
    const options = {
      label,
      value,
      ...other,
    };

    return options;
  }
}
