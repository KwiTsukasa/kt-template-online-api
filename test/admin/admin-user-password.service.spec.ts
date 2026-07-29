import { getMetadataArgsStorage } from 'typeorm';
import { AdminUser } from '../../src/modules/admin/identity/user/admin-user.entity';
import { AdminUserService } from '../../src/modules/admin/identity/user/admin-user.service';

describe('AdminUserService password contract', () => {
  const userRepository = {
    create: jest.fn((input) => ({ ...input })),
    findOne: jest.fn(),
    save: jest.fn(async (input) => input),
    update: jest.fn(),
  };
  const roleRepository = {
    find: jest.fn(),
  };
  const deptRepository = {
    find: jest.fn(),
  };
  const passwordHashService = {
    hashPassword: jest.fn(async (password: string) => `hashed:${password}`),
  };

  const service = new AdminUserService(
    userRepository as any,
    roleRepository as any,
    deptRepository as any,
    passwordHashService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    roleRepository.find.mockResolvedValue([]);
    userRepository.findOne.mockResolvedValue(null);
  });

  it('requires a password when creating and never falls back to 123456', async () => {
    passwordHashService.hashPassword.mockRejectedValueOnce(
      new Error('密码不能为空'),
    );

    await expect(
      service.createUser({
        realName: '新用户',
        roleIds: [],
        username: 'new-user',
      }),
    ).rejects.toThrow('密码不能为空');
    expect(passwordHashService.hashPassword).toHaveBeenCalledTimes(1);
    expect(passwordHashService.hashPassword).toHaveBeenCalledWith(undefined);
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('hashes a created password exactly once before persistence', async () => {
    await service.createUser({
      password: 'create-password',
      realName: '新用户',
      roleIds: [],
      username: 'new-user',
    });

    expect(passwordHashService.hashPassword).toHaveBeenCalledTimes(1);
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'hashed:create-password',
      }),
    );
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'hashed:create-password',
      }),
    );
  });

  it('keeps an edited password unchanged when the input is empty', async () => {
    const user = {
      id: '1',
      isDeleted: false,
      password: 'stored-hash',
      roles: [],
      username: 'admin',
    };
    userRepository.findOne.mockResolvedValue(user);

    await service.updateUser('1', { password: '', realName: '新姓名' });

    expect(passwordHashService.hashPassword).not.toHaveBeenCalled();
    expect(user.password).toBe('stored-hash');
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ realName: '新姓名' }),
    );
  });

  it('hashes an edited password exactly once', async () => {
    const user = {
      id: '1',
      isDeleted: false,
      password: 'stored-hash',
      roles: [],
      username: 'admin',
    };
    userRepository.findOne.mockResolvedValue(user);

    await service.updateUser('1', { password: 'updated-password' });

    expect(passwordHashService.hashPassword).toHaveBeenCalledTimes(1);
    expect(user.password).toBe('hashed:updated-password');
  });

  it('requires and hashes an explicit reset password exactly once', async () => {
    const user = {
      id: '1',
      isDeleted: false,
      password: 'stored-hash',
      roles: [],
      username: 'admin',
    };
    userRepository.findOne.mockResolvedValue(user);

    await service.resetUserPassword('1', 'reset-password');

    expect(passwordHashService.hashPassword).toHaveBeenCalledTimes(1);
    expect(passwordHashService.hashPassword).toHaveBeenCalledWith(
      'reset-password',
    );
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'hashed:reset-password' }),
    );
  });

  it('does not select or serialize the password at ordinary entity boundaries', () => {
    const passwordColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === AdminUser && column.propertyName === 'password',
    );
    const serialized = service.serializeUser({
      avatar: '',
      homePath: '/analytics',
      id: '1',
      password: 'must-not-leak',
      realName: '管理员',
      roles: [],
      timezone: 'Asia/Shanghai',
      username: 'admin',
    } as AdminUser);

    expect(passwordColumn?.options.select).toBe(false);
    expect(serialized).not.toHaveProperty('password');
  });
});
