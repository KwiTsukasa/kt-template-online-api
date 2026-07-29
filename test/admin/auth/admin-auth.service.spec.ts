import { AdminAuthService } from '../../../src/modules/admin/identity/auth/admin-auth.service';

const VERSIONED_HASH =
  '$pbkdf2-sha256$v=1$i=600000$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$acCR3Bjb48G7uQRjBo961QHqiLOtaEMb9u_X9DGlq3E';

describe('AdminAuthService password verification', () => {
  const originalAdminCookieSecure = process.env.ADMIN_COOKIE_SECURE;
  const originalNodeEnv = process.env.NODE_ENV;
  const queryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
  const userRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    findOne: jest.fn(),
  };
  const tokenService = {
    signAccessToken: jest.fn(() => 'access-token'),
    signRefreshToken: jest.fn(() => 'refresh-token'),
    verifyAccessToken: jest.fn(),
    verifyRefreshToken: jest.fn(),
  };
  const toolsService = {
    readBearerToken: jest.fn(),
    readCookie: jest.fn(),
  };
  const passwordHashService = {
    verifyPassword: jest.fn(),
  };
  const rateLimitService = {
    clearSuccessfulLoginUsername: jest.fn(),
    consumeVerifiedTokenSubject: jest.fn(),
  };

  const service = new AdminAuthService(
    userRepository as any,
    tokenService as any,
    toolsService as any,
    passwordHashService as any,
    rateLimitService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilder.addSelect.mockReturnThis();
    queryBuilder.leftJoinAndSelect.mockReturnThis();
    queryBuilder.where.mockReturnThis();
    rateLimitService.clearSuccessfulLoginUsername.mockResolvedValue(undefined);
    rateLimitService.consumeVerifiedTokenSubject.mockResolvedValue(undefined);
    tokenService.signAccessToken.mockReturnValue('access-token');
    tokenService.signRefreshToken.mockReturnValue('refresh-token');
  });

  afterEach(() => {
    if (originalAdminCookieSecure === undefined) {
      delete process.env.ADMIN_COOKIE_SECURE;
    } else {
      process.env.ADMIN_COOKIE_SECURE = originalAdminCookieSecure;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('explicitly selects the password hash, verifies it, and omits it from the result', async () => {
    queryBuilder.getOne.mockResolvedValue({
      id: '1',
      isDeleted: false,
      password: VERSIONED_HASH,
      roles: [],
      status: 1,
      username: 'admin',
    });
    passwordHashService.verifyPassword.mockResolvedValue(true);
    const result = await service.login('admin', 'Correct horse 电池');

    expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.password');
    expect(passwordHashService.verifyPassword).toHaveBeenCalledWith(
      'Correct horse 电池',
      VERSIONED_HASH,
    );
    expect(result.user).not.toHaveProperty('password');
    expect(result).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(rateLimitService.clearSuccessfulLoginUsername).toHaveBeenCalledWith(
      'admin',
    );
  });

  it('rejects an unversioned plaintext password without a compatibility fallback', async () => {
    queryBuilder.getOne.mockResolvedValue({
      id: '1',
      isDeleted: false,
      password: 'legacy-plaintext',
      roles: [],
      status: 1,
      username: 'admin',
    });
    passwordHashService.verifyPassword.mockResolvedValue(false);

    await expect(
      service.login('admin', 'legacy-plaintext'),
    ).rejects.toMatchObject({
      response: {
        err: 'Username or password is incorrect.',
        msg: 'Username or password is incorrect.',
      },
      status: 403,
    });
    expect(passwordHashService.verifyPassword).toHaveBeenCalledWith(
      'legacy-plaintext',
      'legacy-plaintext',
    );
  });

  it.each([
    {
      label: 'unknown user',
      passwordHash: undefined,
      user: null,
      verified: false,
    },
    {
      label: 'disabled user',
      passwordHash: VERSIONED_HASH,
      user: {
        id: '2',
        isDeleted: false,
        password: VERSIONED_HASH,
        status: 0,
        username: 'disabled',
      },
      verified: true,
    },
    {
      label: 'wrong password',
      passwordHash: VERSIONED_HASH,
      user: {
        id: '3',
        isDeleted: false,
        password: VERSIONED_HASH,
        status: 1,
        username: 'active',
      },
      verified: false,
    },
  ])(
    'uses one dummy/real verification and the same external failure for $label',
    async ({ passwordHash, user, verified }) => {
      queryBuilder.getOne.mockResolvedValue(user);
      passwordHashService.verifyPassword.mockResolvedValue(verified);

      let failure: any;
      try {
        await service.login(user?.username || 'missing', 'guess');
      } catch (error) {
        failure = error;
      }

      expect(passwordHashService.verifyPassword).toHaveBeenCalledTimes(1);
      expect(
        rateLimitService.clearSuccessfulLoginUsername,
      ).not.toHaveBeenCalled();
      expect(passwordHashService.verifyPassword).toHaveBeenCalledWith(
        'guess',
        passwordHash,
      );
      expect({
        response: failure?.response,
        status: failure?.status,
      }).toEqual({
        response: {
          err: 'Username or password is incorrect.',
          msg: 'Username or password is incorrect.',
        },
        status: 403,
      });
    },
  );

  it('does not issue tokens when successful-login Redis cleanup fails', async () => {
    queryBuilder.getOne.mockResolvedValue({
      id: '1',
      isDeleted: false,
      password: VERSIONED_HASH,
      roles: [],
      status: 1,
      username: 'admin',
    });
    passwordHashService.verifyPassword.mockResolvedValue(true);
    rateLimitService.clearSuccessfulLoginUsername.mockRejectedValue(
      new Error('redis unavailable'),
    );

    await expect(service.login('admin', 'correct password')).rejects.toThrow(
      'redis unavailable',
    );
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    expect(tokenService.signRefreshToken).not.toHaveBeenCalled();
  });

  it('counts only a verified refresh subject and ignores a forged token subject', async () => {
    const response = { setHeader: jest.fn() };
    tokenService.verifyRefreshToken
      .mockReturnValueOnce({
        sub: 'user-42',
        username: 'admin',
      })
      .mockReturnValueOnce(null);
    userRepository.findOne.mockResolvedValue({
      id: 'user-42',
      roles: [],
      username: 'admin',
    });
    rateLimitService.consumeVerifiedTokenSubject.mockResolvedValue(undefined);

    await service.refresh('valid-token', response as any);
    expect(rateLimitService.consumeVerifiedTokenSubject).toHaveBeenCalledWith(
      'refresh',
      'user-42',
      response,
    );

    rateLimitService.consumeVerifiedTokenSubject.mockClear();
    await expect(service.refresh('forged-token')).rejects.toMatchObject({
      status: 403,
    });
    expect(rateLimitService.consumeVerifiedTokenSubject).not.toHaveBeenCalled();
  });

  it('counts logout subject only when the refresh token signature is valid', async () => {
    const response = { setHeader: jest.fn() };
    tokenService.verifyRefreshToken
      .mockReturnValueOnce({
        sub: 'user-42',
        username: 'admin',
      })
      .mockReturnValueOnce(null);

    await service.consumeLogoutSubject('valid-token', response as any);
    expect(rateLimitService.consumeVerifiedTokenSubject).toHaveBeenCalledWith(
      'logout',
      'user-42',
      response,
    );

    rateLimitService.consumeVerifiedTokenSubject.mockClear();
    await service.consumeLogoutSubject('forged-token');
    expect(rateLimitService.consumeVerifiedTokenSubject).not.toHaveBeenCalled();
  });

  it('sets production access and refresh cookies with the locked safe attributes', () => {
    process.env.ADMIN_COOKIE_SECURE = 'false';
    process.env.NODE_ENV = 'production';
    const response = {
      cookie: jest.fn(),
    };

    service.setAccessTokenCookie(response as any, 'access-token');
    service.setRefreshTokenCookie(response as any, 'refresh-token');

    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      'admin_access_token',
      'access-token',
      {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
        sameSite: 'lax',
        secure: true,
      },
    );
    expect(response.cookie).toHaveBeenNthCalledWith(2, 'jwt', 'refresh-token', {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      secure: true,
    });
    response.cookie.mock.calls.forEach(([, , options]) =>
      expect(options).not.toHaveProperty('domain'),
    );
  });

  it('clears both token cookies on every current and historical path with matching attributes', () => {
    process.env.ADMIN_COOKIE_SECURE = 'true';
    process.env.NODE_ENV = 'test';
    const response = {
      clearCookie: jest.fn(),
    };

    service.clearAccessTokenCookie(response as any);
    service.clearRefreshTokenCookie(response as any);

    expect(response.clearCookie.mock.calls).toHaveLength(6);
    expect(
      response.clearCookie.mock.calls.map(([name, options]) => [
        name,
        options.path,
      ]),
    ).toEqual([
      ['admin_access_token', '/'],
      ['admin_access_token', '/api/auth'],
      ['admin_access_token', '/auth'],
      ['jwt', '/'],
      ['jwt', '/api/auth'],
      ['jwt', '/auth'],
    ]);
    response.clearCookie.mock.calls.forEach(([, options]) => {
      expect(options).toEqual({
        httpOnly: true,
        path: expect.any(String),
        sameSite: 'lax',
        secure: true,
      });
      expect(options).not.toHaveProperty('domain');
    });
  });
});
