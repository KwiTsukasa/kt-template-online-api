import { Injectable } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';
import { DictKeyMap, DictKeyEnum } from './constant';
import type { DictKeyType } from './constant';
import { isBoolean } from 'lodash';

@Injectable()
export class ToolsService {
  async captche(size = 4) {
    const captcha = svgCaptcha.create({
      //可配置返回的图片信息
      size, //生成几个验证码
      fontSize: 50, //文字大小
      width: 100, //宽度
      height: 34, //高度
      background: '#ffffff', //背景颜色
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
    operator = 'AND',
  ): [string, Record<keyof T, string>] {
    const linkOperator = ` ${operator} `;
    const wheresEndIndex = wheres.length;

    return [
      [...wheres, ...likes].reduce((pre, cur, index, source) => {
        const isLink = !!source
          .slice(0, index)
          .some((key) => isBoolean(values[key]) || !!values[key]);

        const { getLikeStr, getWhereStr } = this;

        if (!isBoolean(values[cur]) && !values[cur]) return pre;

        if (!index) getWhereStr(alias, cur);

        const matchSqlFn = index >= wheresEndIndex ? getLikeStr : getWhereStr;
        const beforeSql = `${pre}${isLink ? linkOperator : ' '}`;

        return `${beforeSql}${matchSqlFn(alias, cur)}`;
      }, ''),
      Object.entries(values).reduce((pre, [key, value]) => {
        if (!isBoolean(value) && !value) return pre;

        if (likes.includes(key as keyof T))
          return { ...pre, ...{ [key]: `%${value}%` } };

        return { ...pre, ...{ [key]: value } };
      }, {} as Record<keyof T, string>),
    ];
  }

  getDictByKey(key: DictKeyType): Dict[] {
    if (!DictKeyEnum[key]) {
      return [];
    }

    return DictKeyMap.get(key);
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
