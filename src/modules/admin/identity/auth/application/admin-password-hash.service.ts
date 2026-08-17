import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { throwVbenError } from '@/common';

export const ADMIN_PASSWORD_HASH_ITERATIONS = 600_000;
export const ADMIN_PASSWORD_MAX_BYTES = 128;

const ADMIN_PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256';
const ADMIN_PASSWORD_HASH_VERSION = 1;
const ADMIN_PASSWORD_HASH_DIGEST = 'sha256';
const ADMIN_PASSWORD_HASH_SALT_BYTES = 32;
const ADMIN_PASSWORD_HASH_DIGEST_BYTES = 32;
const ADMIN_PASSWORD_HASH_PATTERN =
  /^\$pbkdf2-sha256\$v=1\$i=600000\$([A-Za-z0-9_-]{43})\$([A-Za-z0-9_-]{43})$/;
const ADMIN_PASSWORD_DUMMY_VALUE = 'kt-admin-password-dummy-v1';
const ADMIN_PASSWORD_DUMMY_HASH =
  '$pbkdf2-sha256$v=1$i=600000$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$ZGtKNyJTIEn5iojI0FiWSWh2J-seLiTUbRDxSf5Hz-A';

export type AdminPasswordHashCryptoDependencies = {
  pbkdf2: typeof pbkdf2;
  randomBytes: typeof randomBytes;
  timingSafeEqual: typeof timingSafeEqual;
};

type ParsedAdminPasswordHash = {
  digest: Buffer;
  salt: Buffer;
};

export const ADMIN_PASSWORD_HASH_CRYPTO_DEPENDENCIES = Symbol(
  'ADMIN_PASSWORD_HASH_CRYPTO_DEPENDENCIES',
);

const DEFAULT_CRYPTO_DEPENDENCIES: AdminPasswordHashCryptoDependencies = {
  pbkdf2,
  randomBytes,
  timingSafeEqual,
};

@Injectable()
export class AdminPasswordHashService {
  private readonly cryptoDependencies: AdminPasswordHashCryptoDependencies;

  constructor(
    @Optional()
    @Inject(ADMIN_PASSWORD_HASH_CRYPTO_DEPENDENCIES)
    cryptoDependencies?: AdminPasswordHashCryptoDependencies,
  ) {
    this.cryptoDependencies = cryptoDependencies || DEFAULT_CRYPTO_DEPENDENCIES;
  }

  /**
   * 校验明文密码边界后生成随机盐并执行 PBKDF2，最终编码算法、迭代次数、盐值与摘要。
   * @param password - 决定明文密码边界后生成随机盐并执行 PBKDF2，最终编码算法、迭代次数、盐值与摘要内容、边界或目标的 `password` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足hash密码约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async hashPassword(password?: string) {
    this.assertHashablePassword(password);
    const salt = this.cryptoDependencies.randomBytes(
      ADMIN_PASSWORD_HASH_SALT_BYTES,
    );
    const digest = await this.derivePassword(password, salt);
    return [
      '',
      ADMIN_PASSWORD_HASH_ALGORITHM,
      `v=${ADMIN_PASSWORD_HASH_VERSION}`,
      `i=${ADMIN_PASSWORD_HASH_ITERATIONS}`,
      salt.toString('base64url'),
      digest.toString('base64url'),
    ].join('$');
  }

  /**
   * 根据`value`与当前约束判定密码摘要。
   * @param value - 待判定是否满足密码摘要约束的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足密码摘要约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
   */
  isPasswordHash(value?: string) {
    return this.parsePasswordHash(value) !== null;
  }

  /**
   * 解析已编码密码摘要并以固定上限校验明文；无效摘要或超限输入走虚假摘要比较以维持时序一致。
   * @param password - 决定已编码密码摘要并以固定上限校验明文内容、边界或目标的 `password` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param encodedHash - 决定已编码密码摘要并以固定上限校验明文内容、边界或目标的 `encodedHash` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足已编码密码摘要并以固定上限校验明文约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   * @throws 当 `!comparisonHash` 成立时拒绝当前输入并抛出 `Error`。
   */
  async verifyPassword(password?: string, encodedHash?: string) {
    const parsedHash = this.parsePasswordHash(encodedHash);
    const comparisonHash =
      parsedHash || this.parsePasswordHash(ADMIN_PASSWORD_DUMMY_HASH);
    if (!comparisonHash) {
      throw new Error('Admin password dummy hash is invalid');
    }

    const passwordIsValid = this.isPasswordWithinLimit(password);
    const derived = await this.derivePassword(
      (() => {
        if (passwordIsValid) {
          return password;
        }
        return ADMIN_PASSWORD_DUMMY_VALUE;
      })(),
      comparisonHash.salt,
    );
    const matches = this.cryptoDependencies.timingSafeEqual(
      derived,
      comparisonHash.digest,
    );
    return Boolean(parsedHash && passwordIsValid && matches);
  }

  /**
   * 校验`password`是否满足密码是否满足摘要生成要求约束，并拒绝不合法输入。
   * @param password - 用于密码是否满足摘要生成要求的领域对象，包含 `length` 字段；为空时采用 `password.length === 0` 作为兜底。
   */
  private assertHashablePassword(
    password?: string,
  ): asserts password is string {
    if (typeof password !== 'string' || password.length === 0) {
      throwVbenError(
        '密码不能为空',
        HttpStatus.BAD_REQUEST,
        'BadRequestException',
      );
    }
    if (Buffer.byteLength(password, 'utf8') > ADMIN_PASSWORD_MAX_BYTES) {
      throwVbenError(
        `密码不能超过 ${ADMIN_PASSWORD_MAX_BYTES} 个 UTF-8 字节`,
        HttpStatus.BAD_REQUEST,
        'BadRequestException',
      );
    }
  }

  /**
   * 使用固定摘要算法、迭代次数和长度异步派生密码材料，并把底层失败作为 Promise 拒绝。
   * @param password - 决定derive密码内容、边界或目标的 `password` 值。
   * @param salt - 决定derive密码内容、边界或目标的 `salt` 值。
   * @returns 完成初始化并携带当前边界配置的derive密码。
   */
  private derivePassword(password: string, salt: Buffer) {
    return new Promise<Buffer>((resolve, reject) => {
      this.cryptoDependencies.pbkdf2(
        password,
        salt,
        ADMIN_PASSWORD_HASH_ITERATIONS,
        ADMIN_PASSWORD_HASH_DIGEST_BYTES,
        ADMIN_PASSWORD_HASH_DIGEST,
        (error, derivedKey) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(derivedKey);
        },
      );
    });
  }

  /**
   * 根据`password`与当前约束判定密码是否在限制范围内。
   * @param password - 用于密码是否在限制范围内的领域对象，包含 `length` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足密码是否在限制范围内约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isPasswordWithinLimit(password?: string): password is string {
    return (
      typeof password === 'string' &&
      password.length > 0 &&
      Buffer.byteLength(password, 'utf8') <= ADMIN_PASSWORD_MAX_BYTES
    );
  }

  /**
   * 从`value`解析密码摘要；当 `salt.length !== ADMIN_PASSWORD_HASH_SALT_BYTES || digest.leng…` 成立时返回 `null`。
   * @param value - 待转换为密码摘要的原始值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 包含 `digest`、`salt` 字段的密码摘要；无法解析或未命中时为 `null`。
   */
  private parsePasswordHash(value?: string): ParsedAdminPasswordHash | null {
    if (typeof value !== 'string') return null;
    const match = ADMIN_PASSWORD_HASH_PATTERN.exec(value);
    if (!match) return null;

    const salt = Buffer.from(match[1], 'base64url');
    const digest = Buffer.from(match[2], 'base64url');
    if (
      salt.length !== ADMIN_PASSWORD_HASH_SALT_BYTES ||
      digest.length !== ADMIN_PASSWORD_HASH_DIGEST_BYTES ||
      salt.toString('base64url') !== match[1] ||
      digest.toString('base64url') !== match[2]
    ) {
      return null;
    }

    return { digest, salt };
  }
}
