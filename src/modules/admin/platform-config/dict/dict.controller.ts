import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DictService } from './dict.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApiArrayResponse,
  ApiPageResponse,
  vbenPage,
  vbenSuccess,
} from '@/common';
import {
  AdminDictBodyDto,
  AdminDictDto,
  AdminDictGroupDto,
  AdminDictQueryDto,
  AdminDictTreeDto,
  AdminDictUpdateDto,
  DictDto,
} from './dict.dto';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';

const componentTypeDictExample = [
  {
    label: '图表',
    value: 1,
  },
  {
    label: '组件',
    value: 2,
  },
];

const chartDictExample = [
  {
    label: '未分类',
    value: -1,
  },
  {
    label: '折线图',
    value: 1,
  },
];

@ApiTags('Admin - 字典管理')
@Controller('dict')
@UseGuards(JwtAuthGuard)
export class DictController {
  constructor(private readonly dictService: DictService) {}

  /**
   * 根据参数 `query`，获取字典分页列表。
   * @param query - 限定根据参数 `query`，获取字典分页列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取字典分页列表。
   */
  @ApiOperation({ summary: '获取字典分页列表' })
  @ApiPageResponse(AdminDictDto, [
    {
      id: '2041700000000300001',
      dictCode: 'COMPONENT_TYPE',
      label: '图表',
      value: '1',
      childrenCode: 'CHART',
      sort: 1,
      status: 1,
    },
  ])
  @Get('list')
  async list(@Query() query: AdminDictQueryDto) {
    const page = await this.dictService.page(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 根据`query`处理字典树列表。
   * @param query - 限定字典树列表筛选、排序与分页范围的查询条件。
   * @returns 字典树列表。
   */
  @ApiOperation({ summary: '获取字典树列表' })
  @ApiArrayResponse(AdminDictTreeDto, [
    {
      id: '2041700000000300001',
      dictCode: 'COMPONENT_TYPE',
      label: '图表',
      value: '1',
      childrenCode: 'CHART',
      sort: 1,
      status: 1,
      treeKey: '2041700000000300001',
      children: [
        {
          id: '2041700000000300002',
          dictCode: 'CHART',
          label: '折线图',
          value: '1',
          sort: 1,
          status: 1,
          treeKey: '2041700000000300001/2041700000000300002',
        },
      ],
    },
  ])
  @Get('tree')
  async tree(@Query() query: AdminDictQueryDto) {
    return vbenSuccess(await this.dictService.tree(query));
  }

  /**
   * 根据参数 `query`，获取字典编码分组列表。
   * @param query - 限定根据参数 `query`，获取字典编码分组列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取字典编码分组列表。
   */
  @ApiOperation({ summary: '获取字典编码分组列表' })
  @ApiPageResponse(AdminDictGroupDto, [
    {
      dictCode: 'COMPONENT_TYPE',
      id: 'dict-code:COMPONENT_TYPE',
      itemCount: 2,
      label: 'COMPONENT_TYPE',
      value: 'COMPONENT_TYPE',
    },
  ])
  @Get('groups')
  async groups(@Query() query: AdminDictQueryDto) {
    const page = await this.dictService.groups(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 根据当前领域状态，获取字典编码选项。
   * @returns 根据当前领域状态，获取字典编码选项。
   */
  @ApiOperation({ summary: '获取字典编码选项' })
  @Get('codes')
  async codes() {
    return vbenSuccess(await this.dictService.getDictCodeOptions());
  }

  /**
   * 按字典键读取启用项，将可转数值的字典值标准化后封装为成功响应。
   * @param dictKey - 用于筛选字典项的字典键。
   * @returns 返回包含字典选项的 Vben 成功响应；未命中时选项为空数组。
   */
  @ApiOperation({ summary: '根据key获取字典' })
  @ApiQuery({ name: 'dictKey', type: String })
  @ApiArrayResponse(DictDto, componentTypeDictExample)
  @Get('getDictByKey')
  async getDictByKey(@Query('dictKey') dictKey: string) {
    const dict = await this.dictService.getDictByKey(dictKey);

    return vbenSuccess(dict);
  }

  /**
   * 根据组件类型获取组件字典。
   * @param type - 决定根据组件类型获取组件字典内容、边界或目标的 `type` 值。
   * @returns 根据组件类型获取组件字典。
   */
  @ApiOperation({ summary: '根据组件类型获取组件字典' })
  @ApiQuery({ name: 'type', type: Number })
  @ApiArrayResponse(DictDto, chartDictExample)
  @Get('getComponentDictByType')
  async getComponentDictByType(@Query('type', ParseIntPipe) type) {
    const dict = await this.dictService.getComponentDictByType(type);

    return vbenSuccess(dict);
  }

  /**
   * 根据`body`更新针对字典项。
   * @param body - 用于针对字典项的结构化输入。
   * @returns 针对字典项。
   */
  @ApiOperation({ summary: '新增字典项' })
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async save(@Body() body: AdminDictBodyDto) {
    return vbenSuccess(await this.dictService.save(body));
  }

  /**
   * 根据`body`更新针对字典项。
   * @param body - 用于针对字典项的结构化输入。
   * @returns 针对字典项。
   */
  @ApiOperation({ summary: '编辑字典项' })
  @Post('update')
  @HttpCode(HttpStatus.OK)
  async update(@Body() body: AdminDictUpdateDto) {
    return vbenSuccess(await this.dictService.update(body));
  }

  /**
   * 按`id`移除针对删除字典项。
   * @param id - 决定针对删除字典项内容、边界或目标的 `id` 值。
   * @returns 针对删除字典项。
   */
  @ApiOperation({ summary: '删除字典项' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.dictService.remove(id));
  }

  /**
   * 根据`id`、`status`处理启停字典项。
   * @param id - 决定启停字典项内容、边界或目标的 `id` 值。
   * @param status - 决定启停字典项内容、边界或目标的 `status` 值。
   * @returns 启停字典项。
   */
  @ApiOperation({ summary: '启停字典项' })
  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'status', type: Number })
  async toggle(@Query('id') id: string, @Query('status') status: string) {
    return vbenSuccess(await this.dictService.toggle(id, Number(status)));
  }
}
