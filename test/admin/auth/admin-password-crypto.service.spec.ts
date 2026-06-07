import { constants, publicEncrypt } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { AdminPasswordCryptoService } from '../../../src/admin/auth/admin-password-crypto.service';

describe('AdminPasswordCryptoService', () => {
  it('decrypts password encrypted by the exported public key', () => {
    const service = new AdminPasswordCryptoService();
    const { hash, publicKey } = service.getPublicKey();
    const encryptedPassword = publicEncrypt(
      {
        key: publicKey,
        oaepHash: hash.toLowerCase().replace('-', ''),
        padding: constants.RSA_PKCS1_OAEP_PADDING,
      },
      Buffer.from('123456', 'utf8'),
    ).toString('base64');

    expect(service.decryptPassword(encryptedPassword)).toBe('123456');
  });

  it('rejects invalid encrypted password payloads', () => {
    const service = new AdminPasswordCryptoService();

    try {
      service.decryptPassword('not-base64');
      throw new Error('decryptPassword should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({
          err: 'BadRequestException',
          msg: 'Password decrypt failed',
        }),
      );
    }
  });
});
