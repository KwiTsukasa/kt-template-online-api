import { AdminUserService } from '../../src/modules/admin/identity/user/admin-user.service';

describe('AdminUserService profile', () => {
  const userRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
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

  it('updates current profile fields including uploaded avatar url', async () => {
    const user = {
      avatar: '',
      homePath: '/workspace',
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

  it('serializes avatar and userId for Admin frontend user store', () => {
    expect(
      service.serializeUser({
        avatar: '/api/minio/download?objectName=avatars%2Favatar.jpg',
        homePath: '/workspace',
        id: '2041700000000000001',
        realName: '管理员',
        roles: [],
        timezone: 'Asia/Shanghai',
        username: 'admin',
      } as any),
    ).toEqual({
      avatar: '/api/minio/download?objectName=avatars%2Favatar.jpg',
      homePath: '/workspace',
      id: '2041700000000000001',
      realName: '管理员',
      roles: [],
      timezone: 'Asia/Shanghai',
      userId: '2041700000000000001',
      username: 'admin',
    });
  });
});
