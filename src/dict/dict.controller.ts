import { Controller, Get, HttpStatus, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ToolsService } from '@/utils/tool.service';
import { DictService } from './dict.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ComponentTypeEnum, DictKeyEnum, DictKeyType } from '@/utils/constant';

@ApiTags('dict')
@Controller('dict')
export class DictController {
  constructor(
    private readonly toolsService: ToolsService,
    private readonly dictService: DictService,
  ) {} //注入服务

  @ApiOperation({ summary: '根据key获取字典' })
  @ApiQuery({ name: 'dictKey', enum: DictKeyEnum })
  @Get('getDictByKey')
  async getDictByKey(@Res() res, @Query('dictKey') dictKey: DictKeyType) {
    const dict = this.toolsService.getDictByKey(dictKey)

    return res.send(
      this.toolsService.res(
        HttpStatus.OK,
        '操作成功',
        dict,
      ),
    );
  }

  @ApiOperation({ summary: '根据组件类型获取组件字典' })
  @ApiQuery({ name: 'type', enum: ComponentTypeEnum })
  @Get('getComponentDictByType')
  async getComponentDictByType(@Res() res, @Query('type', ParseIntPipe) type) {
    const dict = await this.dictService.getComponentDictByType(type)

    return res.send(
      this.toolsService.res(
        HttpStatus.OK,
        '操作成功',
        dict,
      ),
    );
  }
}
