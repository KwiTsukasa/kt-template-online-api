import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import {
  PaginatedDto,
  ApiArrayResponse,
  ApiModelResponse,
  ApiPageResponse,
  ApiSuccessResponse,
  type KtPageParams,
  ToolsService,
} from '@/common';
import { JwtAuthGuard } from '../../identity/auth/jwt-auth.guard';
import { ComponentService } from './component.service';
import { Component } from './component.entity';

const componentExample = {
  id: '2041739550026043392',
  name: '基础折线图',
  type: 1,
  componentType: 1,
  typeMsg: '图表',
  componentTypeMsg: '折线图',
  image: '',
  template: '%7B%22version%22%3A%221.0%22%7D',
  createTime: '2026-05-13 10:30:00',
  updateTime: '2026-05-13 10:30:00',
  is_deleted: false,
};

class CompPageDto
  extends PartialType(Component)
  implements KtPageParams<Component>
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
@ApiTags('Admin - 组件管理')
@ApiExtraModels(PaginatedDto)
@UseGuards(JwtAuthGuard)
export class ComponentController {
  /**
   * 初始化 ComponentController 实例。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param componentService - componentService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly toolsService: ToolsService,
    private readonly componentService: ComponentService,
  ) {}

  /**
   * 获取组件列表。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   */
  @Get('allList')
  @ApiOperation({ summary: '获取组件列表' })
  @ApiArrayResponse(Component, [componentExample])
  async getAllList(@Res() res) {
    const list = await this.componentService.all();
    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', list));
  }

  /**
   * 获取组件列表分页。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param { pageNo, pageSize, ...args } - HTTP 查询参数，提供组件配置查询或解析所需字段，读取 `pageNo`、`pageSize`、`args` 字段。
   * @returns Admin 平台配置查询结果。
   */
  @Get('list')
  @ApiOperation({ summary: '获取组件列表分页' })
  @ApiQuery({ type: [CompPageDto] })
  @ApiPageResponse(Component, [componentExample], 1)
  async getList(
    @Res() res,
    @Query() { pageNo, pageSize, ...args }: KtPageParams<Component>,
  ): Promise<PaginatedDto<Component>> {
    const list = await this.componentService.page({
      pageNo,
      pageSize,
      ...args,
    });
    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', list));
    return;
  }

  /**
   * 保存组件。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param component - component 输入；驱动 `componentService.save()` 的 Admin步骤。
   */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存组件' })
  @ApiSuccessResponse({
    schema: {
      type: 'string',
      description: '新增组件ID',
    },
    example: '2041739550026043392',
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

  /**
   * 删除组件。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
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

  /**
   * 编辑组件。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param component - component 输入；驱动 `componentService.update()` 的 Admin步骤。
   */
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

  /**
   * 组件详情。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  @Get('detail')
  @ApiOperation({ summary: '组件详情' })
  @ApiQuery({ name: 'id', type: String })
  @ApiModelResponse(Component, componentExample)
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
