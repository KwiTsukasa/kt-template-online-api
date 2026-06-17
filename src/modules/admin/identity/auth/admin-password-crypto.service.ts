import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { throwVbenError } from '@/common';

@Injectable()
export class AdminPasswordCryptoService {
  private readonly privateKey: string;

  private readonly publicKey: string;

  /**
   * 初始化 AdminPasswordCryptoService 实例。
   */
  constructor() {
    const keyPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: {
        format: 'pem',
        type: 'pkcs8',
      },
      publicKeyEncoding: {
        format: 'pem',
        type: 'spki',
      },
    });

    this.privateKey = keyPair.privateKey;
    this.publicKey = keyPair.publicKey;
  }

  /**
   * 查询 Admin 身份权限数据。
   */
  getPublicKey() {
    return {
      algorithm: 'RSA-OAEP' as const,
      hash: 'SHA-256' as const,
      publicKey: this.publicKey,
    };
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param encryptedPassword - encryptedPassword 输入；驱动 `Buffer.from()` 的 Admin步骤。
   */
  decryptPassword(encryptedPassword?: string) {
    if (!encryptedPassword) {
      throwVbenError(
        'Encrypted password is required',
        HttpStatus.BAD_REQUEST,
        'BadRequestException',
      );
    }

    try {
      return privateDecrypt(
        {
          key: this.privateKey,
          oaepHash: 'sha256',
          padding: constants.RSA_PKCS1_OAEP_PADDING,
        },
        Buffer.from(encryptedPassword, 'base64'),
      ).toString('utf8');
    } catch {
      throwVbenError(
        'Password decrypt failed',
        HttpStatus.BAD_REQUEST,
        'BadRequestException',
      );
    }
  }
}
