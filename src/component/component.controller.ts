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
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { ToolsService } from 'src/utils/tool.service';
import { ComponentService } from './component.service';
import { Component } from './component.entity';
import { PaginatedDto } from '@/utils/constant';
import { ComponentDto } from './component.dto';

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

class CompPageResDto extends PaginatedDto {
  @ApiProperty({
    type: [ComponentDto],
  })
  list: ComponentDto[];
}

@Controller('component')
@ApiTags('component')
@ApiExtraModels(PaginatedDto, ComponentDto)
export class ComponentController {
  constructor(
    private readonly toolsService: ToolsService,
    private readonly componentService: ComponentService,
  ) {} //注入服务

  @Get('allList')
  @ApiOperation({ summary: '获取组件列表' })
  @ApiOkResponse({ type: [ComponentDto] })
  async getAllList(@Res() res) {
    const list = await this.componentService.all();
    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', list));
  }

  @Get('list')
  @ApiOperation({ summary: '获取组件列表分页' })
  @ApiQuery({ type: [CompPageDto] })
  @ApiOkResponse({
    type: CompPageResDto,
  })
  async getList(
    @Res() res,
    @Query() { pageNo, pageSize, ...args }: PageParams<ComponentDto>,
  ): Promise<CompPageResDto> {
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
  @ApiOkResponse({ type: ComponentDto })
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
