import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  ADMIN_PASSWORD_HASH_ITERATIONS,
  ADMIN_PASSWORD_MAX_BYTES,
  AdminPasswordHashService,
} from '../../../src/modules/admin/identity/auth/admin-password-hash.service';

const FIXED_PASSWORD = 'Correct horse 电池';
const FIXED_HASH =
  '$pbkdf2-sha256$v=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E';

describe('AdminPasswordHashService', () => {
  it('produces the complete deterministic format with a fixed salt', async () => {
    const service = new AdminPasswordHashService({
      pbkdf2,
      randomBytes: jest.fn(() => Buffer.alloc(32, 1)) as typeof randomBytes,
      timingSafeEqual,
    });

    await expect(service.hashPassword(FIXED_PASSWORD)).resolves.toBe(
      FIXED_HASH,
    );
    expect(service.isPasswordHash(FIXED_HASH)).toBe(true);
  });

  it('uses a distinct random salt for each ordinary hash', async () => {
    const service = new AdminPasswordHashService();

    const first = await service.hashPassword('same-password');
    const second = await service.hashPassword('same-password');

    expect(first).not.toBe(second);
    expect(service.isPasswordHash(first)).toBe(true);
    expect(service.isPasswordHash(second)).toBe(true);
  });

  it('verifies correct and incorrect passwords through timingSafeEqual', async () => {
    const compare = jest.fn(timingSafeEqual);
    const service = new AdminPasswordHashService({
      pbkdf2,
      randomBytes,
      timingSafeEqual: compare,
    });

    await expect(
      service.verifyPassword(FIXED_PASSWORD, FIXED_HASH),
    ).resolves.toBe(true);
    await expect(service.verifyPassword('wrong', FIXED_HASH)).resolves.toBe(
      false,
    );
    expect(compare).toHaveBeenCalledTimes(2);
    expect(
      compare.mock.calls.every(
        ([left, right]) => (left as Buffer).length === (right as Buffer).length,
      ),
    ).toBe(true);
  });

  it.each([
    '$pbkdf2-sha256$v=2$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E',
    '$pbkdf2-sha256$v=1$i=599999$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E',
    '$pbkdf2-sha256$version=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E',
    '$pbkdf2-sha256$v=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E',
    '$pbkdf2-sha256$v=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E=',
    '$pbkdf2-sha256$v=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ+$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E',
    `${FIXED_HASH}$extra`,
  ])('strictly rejects an invalid encoded hash: %s', (encoded) => {
    const service = new AdminPasswordHashService();

    expect(service.isPasswordHash(encoded)).toBe(false);
  });

  it('enforces the UTF-8 byte limit instead of JavaScript character count', async () => {
    const fastPbkdf2 = jest.fn(
      (_password, _salt, _iterations, _keyLength, _digest, callback) =>
        callback(null, Buffer.alloc(32, 7)),
    ) as unknown as typeof pbkdf2;
    const service = new AdminPasswordHashService({
      pbkdf2: fastPbkdf2,
      randomBytes: jest.fn(() => Buffer.alloc(32, 2)) as typeof randomBytes,
      timingSafeEqual,
    });
    const withinLimit = '密'.repeat(42);
    const overLimit = '密'.repeat(43);

    expect(Buffer.byteLength(withinLimit, 'utf8')).toBeLessThanOrEqual(
      ADMIN_PASSWORD_MAX_BYTES,
    );
    expect(Buffer.byteLength(overLimit, 'utf8')).toBeGreaterThan(
      ADMIN_PASSWORD_MAX_BYTES,
    );
    await expect(service.hashPassword(withinLimit)).resolves.toMatch(
      /^\$pbkdf2-sha256\$/,
    );
    await expect(service.hashPassword(overLimit)).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: `密码不能超过 ${ADMIN_PASSWORD_MAX_BYTES} 个 UTF-8 字节`,
      }),
    });
  });

  it('uses the same PBKDF2 work and timing-safe comparison for a missing hash', async () => {
    const derive = jest.fn(
      (_password, _salt, _iterations, _keyLength, _digest, callback) =>
        callback(null, Buffer.alloc(32, 9)),
    ) as unknown as typeof pbkdf2;
    const compare = jest.fn(() => false);
    const service = new AdminPasswordHashService({
      pbkdf2: derive,
      randomBytes,
      timingSafeEqual: compare,
    });

    await expect(service.verifyPassword('guess', undefined)).resolves.toBe(
      false,
    );
    expect(derive).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      ADMIN_PASSWORD_HASH_ITERATIONS,
      32,
      'sha256',
      expect.any(Function),
    );
    expect(compare).toHaveBeenCalledWith(
      expect.objectContaining({ length: 32 }),
      expect.objectContaining({ length: 32 }),
    );
  });

  it('propagates PBKDF2 callback failures without emitting a partial hash', async () => {
    const failure = new Error('pbkdf2 failed');
    const failingPbkdf2 = jest.fn(
      (_password, _salt, _iterations, _keyLength, _digest, callback) =>
        callback(failure),
    ) as unknown as typeof pbkdf2;
    const service = new AdminPasswordHashService({
      pbkdf2: failingPbkdf2,
      randomBytes: jest.fn(() => Buffer.alloc(32, 3)) as typeof randomBytes,
      timingSafeEqual,
    });

    await expect(service.hashPassword('valid')).rejects.toBe(failure);
    await expect(service.verifyPassword('valid', FIXED_HASH)).rejects.toBe(
      failure,
    );
  });
});
