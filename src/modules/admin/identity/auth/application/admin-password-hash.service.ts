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

  /** 生成密码摘要。 */
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

  /** 判断密码摘要是否成立。 */
  isPasswordHash(value?: string) {
    return this.parsePasswordHash(value) !== null;
  }

  /** 验证密码。 */
  async verifyPassword(password?: string, encodedHash?: string) {
    const parsedHash = this.parsePasswordHash(encodedHash);
    const comparisonHash =
      parsedHash || this.parsePasswordHash(ADMIN_PASSWORD_DUMMY_HASH);
    if (!comparisonHash) {
      throw new Error('Admin password dummy hash is invalid');
    }

    const passwordIsValid = this.isPasswordWithinLimit(password);
    const derived = await this.derivePassword(
      passwordIsValid ? password : ADMIN_PASSWORD_DUMMY_VALUE,
      comparisonHash.salt,
    );
    const matches = this.cryptoDependencies.timingSafeEqual(
      derived,
      comparisonHash.digest,
    );
    return Boolean(parsedHash && passwordIsValid && matches);
  }

  /** 校验密码是否满足摘要生成要求。 */
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

  /** 推导密码。 */
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

  /** 判断密码是否在限制范围内。 */
  private isPasswordWithinLimit(password?: string): password is string {
    return (
      typeof password === 'string' &&
      password.length > 0 &&
      Buffer.byteLength(password, 'utf8') <= ADMIN_PASSWORD_MAX_BYTES
    );
  }

  /** 解析密码摘要。 */
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
