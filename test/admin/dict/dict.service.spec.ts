jest.mock('@/common', () => {
  const actual = jest.requireActual('@/common');
  return {
    ...actual,
    setDictDecodeCache: jest.fn(),
    throwVbenError: (message: string) => {
      throw new Error(message);
    },
  };
});

import { ToolsService } from '@/common';
import { DictService } from '@/admin/dict/dict.service';

describe('DictService', () => {
  const dictRows = [
    {
      childrenCode: null,
      createTime: new Date('2026-01-01T00:00:00.000Z'),
      dictCode: 'CHART',
      id: 'chart-line',
      label: 'Line',
      sort: 1,
      status: 1,
      updateTime: new Date('2026-01-01T00:00:00.000Z'),
      value: 'line',
    },
    {
      childrenCode: 'CHART',
      createTime: new Date('2026-01-01T00:00:00.000Z'),
      dictCode: 'COMPONENT_TYPE',
      id: 'component-type-chart',
      label: 'Chart',
      sort: 1,
      status: 1,
      updateTime: new Date('2026-01-01T00:00:00.000Z'),
      value: 'chart',
    },
    {
      childrenCode: null,
      createTime: new Date('2026-01-01T00:00:00.000Z'),
      dictCode: 'COMPONENT_TYPE',
      id: 'component-type-basic',
      label: 'Basic',
      sort: 2,
      status: 1,
      updateTime: new Date('2026-01-01T00:00:00.000Z'),
      value: 'basic',
    },
  ];

  function createService() {
    return new DictService(
      {
        find: jest.fn().mockResolvedValue(dictRows),
      } as any,
      new ToolsService(),
    );
  }

  function createGroupService() {
    const countBuilder = {
      getRawOne: jest.fn().mockResolvedValue({ total: '2' }),
      select: jest.fn().mockReturnThis(),
    };
    const builder = {
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnValue(countBuilder),
      getRawMany: jest.fn().mockResolvedValue([
        { dictCode: 'CHART', itemCount: '1' },
        { dictCode: 'COMPONENT_TYPE', itemCount: '2' },
      ]),
      groupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };

    return {
      builder,
      service: new DictService(
        {
          createQueryBuilder: jest.fn().mockReturnValue(builder),
        } as any,
        new ToolsService(),
      ),
    };
  }

  it('paginates dict code groups without building relation tree', async () => {
    const { builder, service } = createGroupService();
    const page = await service.groups({
      dictCode: 'COMPONENT_TYPE',
      pageNo: 1,
      pageSize: 10,
    });

    expect(builder.groupBy).toHaveBeenCalledWith('dict.dictCode');
    expect(page).toEqual({
      items: [
        {
          dictCode: 'CHART',
          id: 'dict-code:CHART',
          itemCount: 1,
          label: 'CHART',
          value: 'CHART',
        },
        {
          dictCode: 'COMPONENT_TYPE',
          id: 'dict-code:COMPONENT_TYPE',
          itemCount: 2,
          label: 'COMPONENT_TYPE',
          value: 'COMPONENT_TYPE',
        },
      ],
      total: 2,
    });
  });

  it('keeps relation tree for childrenCode based business lookup', async () => {
    const tree = await createService().relationTree({
      dictCode: 'COMPONENT_TYPE',
    });

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      dictCode: 'COMPONENT_TYPE',
      id: 'component-type-chart',
    });
    expect(tree[0].children?.map((item) => item.id)).toEqual(['chart-line']);
  });
});
