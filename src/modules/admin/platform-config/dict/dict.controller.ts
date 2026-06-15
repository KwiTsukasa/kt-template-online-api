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
import { JwtAuthGuard } from '../../identity/auth/jwt-auth.guard';

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

  @ApiOperation({ summary: '获取字典编码选项' })
  @Get('codes')
  async codes() {
    return vbenSuccess(await this.dictService.getDictCodeOptions());
  }

  @ApiOperation({ summary: '根据key获取字典' })
  @ApiQuery({ name: 'dictKey', type: String })
  @ApiArrayResponse(DictDto, componentTypeDictExample)
  @Get('getDictByKey')
  async getDictByKey(@Query('dictKey') dictKey: string) {
    const dict = await this.dictService.getDictByKey(dictKey);

    return vbenSuccess(dict);
  }

  @ApiOperation({ summary: '根据组件类型获取组件字典' })
  @ApiQuery({ name: 'type', type: Number })
  @ApiArrayResponse(DictDto, chartDictExample)
  @Get('getComponentDictByType')
  async getComponentDictByType(@Query('type', ParseIntPipe) type) {
    const dict = await this.dictService.getComponentDictByType(type);

    return vbenSuccess(dict);
  }

  @ApiOperation({ summary: '新增字典项' })
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async save(@Body() body: AdminDictBodyDto) {
    return vbenSuccess(await this.dictService.save(body));
  }

  @ApiOperation({ summary: '编辑字典项' })
  @Post('update')
  @HttpCode(HttpStatus.OK)
  async update(@Body() body: AdminDictUpdateDto) {
    return vbenSuccess(await this.dictService.update(body));
  }

  @ApiOperation({ summary: '删除字典项' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.dictService.remove(id));
  }

  @ApiOperation({ summary: '启停字典项' })
  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'status', type: Number })
  async toggle(@Query('id') id: string, @Query('status') status: string) {
    return vbenSuccess(await this.dictService.toggle(id, Number(status)));
  }
}
