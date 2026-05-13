import {
  Controller,
  Get,
  Post,
  Res,
  Query,
  Body,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { ToolsService } from '@/utils/tool.service';
import { ComponentService } from './component.service';
import { Component } from './component.entity';
import { ComponentDto } from './component.dto';
import {
  PaginatedDto,
  ApiArrayResponse,
  ApiModelResponse,
  ApiPageResponse,
  ApiSuccessResponse,
} from '@/common/swagger-response';

const componentExample = {
  id: '1d8d3dd2-99f0-4d10-9a44-0cf9566b37c9',
  name: '基础折线图',
  type: 1,
  componentType: 1,
  typeMsg: '图表',
  componentTypeMsg: '折线图',
  image: '',
  template: '%7B%22version%22%3A%221.0%22%7D',
  createTime: '2026-05-13T02:30:00.000Z',
  updateTime: '2026-05-13T02:30:00.000Z',
  is_deleted: false,
};

class CompPageDto
  extends PartialType(Component)
  implements PageParams<Component>
{
  @ApiProperty({
    type: Number,
    default: 1,
  })
  pageNo: number;
  @ApiProperty({
    type: Number,
    default: 10,
  })
  pageSize: number;
}

@Controller('component')
@ApiTags('component')
@ApiExtraModels(PaginatedDto)
export class ComponentController {
  constructor(
    private readonly toolsService: ToolsService,
    private readonly componentService: ComponentService,
  ) {} //注入服务

  @Get('allList')
  @ApiOperation({ summary: '获取组件列表' })
  @ApiArrayResponse(ComponentDto, [componentExample])
  async getAllList(@Res() res) {
    const list = await this.componentService.all();
    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', list));
  }

  @Get('list')
  @ApiOperation({ summary: '获取组件列表分页' })
  @ApiQuery({ type: [CompPageDto] })
  @ApiPageResponse(ComponentDto, [componentExample], 1)
  async getList(
    @Res() res,
    @Query() { pageNo, pageSize, ...args }: PageParams<ComponentDto>,
  ): Promise<PaginatedDto<ComponentDto>> {
    const list = await this.componentService.page({
      pageNo,
      pageSize,
      ...args,
    });
    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', list));
    return;
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存组件' })
  @ApiSuccessResponse({
    schema: {
      type: 'string',
      description: '新增组件ID',
    },
    example: '1d8d3dd2-99f0-4d10-9a44-0cf9566b37c9',
  })
  async save(@Res() res, @Body() component: Component) {
    const save = await this.componentService.save(component);

    if (!save) {
      res.send(this.toolsService.res(HttpStatus.BAD_REQUEST, '操作失败', null));
      return;
    }

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', save.id));
    return;
  }

  @Post('remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除组件' })
  @ApiQuery({ name: 'id', type: String })
  @ApiSuccessResponse({
    schema: {
      type: 'boolean',
    },
    example: true,
  })
  async remove(@Res() res, @Query('id') id) {
    const remove = await this.componentService.remove(id);

    if (!remove) {
      res.send(
        this.toolsService.res(HttpStatus.BAD_REQUEST, '操作失败', remove),
      );
      return;
    }

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', remove));
    return;
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑组件' })
  @ApiSuccessResponse({
    schema: {
      type: 'boolean',
    },
    example: true,
  })
  async update(@Res() res, @Body() component: Component) {
    const update = await this.componentService.update(component);

    if (!update) {
      res.send(
        this.toolsService.res(HttpStatus.BAD_REQUEST, '操作失败', update),
      );
      return;
    }

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', update));
    return;
  }

  @Get('detail')
  @ApiOperation({ summary: '组件详情' })
  @ApiQuery({ name: 'id', type: String })
  @ApiModelResponse(ComponentDto, componentExample)
  async detail(@Res() res, @Query('id') id) {
    const detail = await this.componentService.find(id);

    if (!detail) {
      res.send(this.toolsService.res(HttpStatus.BAD_REQUEST, '操作失败', null));
      return;
    }

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', detail));
    return;
  }
}
