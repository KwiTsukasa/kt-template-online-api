import { AdminUserService } from '../../src/modules/admin/identity/user/admin-user.service';

describe('AdminUserService profile', () => {
  const userRepository = {
    create: jest.fn((input) => ({ ...input })),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const roleRepository = {
    find: jest.fn(),
  };
  const deptRepository = {
    find: jest.fn(),
  };

  const service = new AdminUserService(
    userRepository as any,
    roleRepository as any,
    deptRepository as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses environment overview as the default home path for created users', async () => {
    userRepository.findOne.mockResolvedValue(null);
    roleRepository.find.mockResolvedValue([]);

    await service.createUser({
      realName: '新用户',
      roleIds: [],
      username: 'new-user',
    });

    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        homePath: '/analytics',
        username: 'new-user',
      }),
    );
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        homePath: '/analytics',
      }),
    );
  });

  it('updates current profile fields including uploaded avatar url', async () => {
    const user = {
      avatar: '',
      homePath: '/analytics',
      id: '2041700000000000001',
      realName: '旧姓名',
      roles: [],
      timezone: 'Asia/Shanghai',
      username: 'admin',
    };
    userRepository.findOne.mockResolvedValue(user);

    const result = await service.updateCurrentProfile(user.id, {
      avatar:
        '/api/minio/download?objectName=avatars%2F2041700000000000001%2Favatar.jpg',
      homePath: '/profile',
      realName: ' 新姓名 ',
    });

    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: ['roles', 'dept'],
        where: {
          id: user.id,
          isDeleted: false,
        },
      }),
    );
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        avatar:
          '/api/minio/download?objectName=avatars%2F2041700000000000001%2Favatar.jpg',
        homePath: '/profile',
        realName: '新姓名',
      }),
    );
    expect(result).toEqual(user);
  });

  it('falls back to environment overview when current profile clears home path', async () => {
    const user = {
      avatar: '',
      homePath: '/profile',
      id: '2041700000000000002',
      realName: 'KwiTsukasa',
      roles: [],
      timezone: 'Asia/Shanghai',
      username: 'kwitsukasa',
    };
    userRepository.findOne.mockResolvedValue(user);

    await service.updateCurrentProfile(user.id, {
      homePath: '',
    });

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        homePath: '/analytics',
      }),
    );
  });

  it('prevents deleting the renamed built-in administrator account', async () => {
    userRepository.findOne.mockResolvedValue({
      id: '2041700000000000002',
      isDeleted: false,
      username: 'kwitsukasa',
    });

    await expect(service.deleteUser('2041700000000000002')).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          msg: '不能删除内置管理员账号',
        }),
      },
    );
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('serializes avatar and userId for Admin frontend user store', () => {
    expect(
      service.serializeUser({
        avatar: '/api/minio/download?objectName=avatars%2Favatar.jpg',
        homePath: '/analytics',
        id: '2041700000000000001',
        realName: '管理员',
        roles: [],
        timezone: 'Asia/Shanghai',
        username: 'admin',
      } as any),
    ).toEqual({
      avatar: '/api/minio/download?objectName=avatars%2Favatar.jpg',
      homePath: '/analytics',
      id: '2041700000000000001',
      realName: '管理员',
      roles: [],
      timezone: 'Asia/Shanghai',
      userId: '2041700000000000001',
      username: 'admin',
    });
  });
});
